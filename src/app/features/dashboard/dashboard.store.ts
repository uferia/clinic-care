import { httpResource } from '@angular/common/http';
import { computed, Service } from '@angular/core';
import { Appointment, AppointmentStatus } from '../appointments/appointment.model';
import { Patient } from '../patients/patient.model';
import { Doctor } from '../doctors/doctor.model';
import { API } from '../../core/api';

type Embedded = Appointment & { patient?: Patient | null; doctor?: Doctor | null };

export interface StatusDatum {
  status: AppointmentStatus;
  count: number;
}

export interface DayDatum {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  count: number;
}

export interface UpcomingRow {
  id: string;
  when: Date;
  patientName: string;
  doctorName: string;
  status: AppointmentStatus;
}

function unwrap<T>(raw: unknown): T[] {
  const r = raw as any;
  return (r?.data ?? r ?? []) as T[];
}

/** Local `YYYY-MM-DD`. Avoids toISOString(), which shifts across the date line. */
function toIsoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

@Service()
export class DashboardStore {
  // The dashboard aggregates across the whole dataset, so it deliberately
  // bypasses pagination. Fine against a mock API of this size; a real backend
  // would expose aggregate endpoints instead of shipping every row.
  private patientsResource = httpResource<Patient[]>(
    () => `${API}/patients?_page=1&_per_page=1000`,
  );
  private doctorsResource = httpResource<Doctor[]>(
    () => `${API}/doctors?_page=1&_per_page=1000`,
  );
  private appointmentsResource = httpResource<Embedded[]>(
    () => `${API}/appointments?_page=1&_per_page=1000&_embed=patient&_embed=doctor`,
  );

  isLoading = computed(
    () =>
      this.patientsResource.isLoading() ||
      this.doctorsResource.isLoading() ||
      this.appointmentsResource.isLoading(),
  );

  error = computed(
    () =>
      this.patientsResource.error() ??
      this.doctorsResource.error() ??
      this.appointmentsResource.error(),
  );

  reload() {
    this.patientsResource.reload();
    this.doctorsResource.reload();
    this.appointmentsResource.reload();
  }

  patients = computed(() => unwrap<Patient>(this.patientsResource.value()));
  doctors = computed(() => unwrap<Doctor>(this.doctorsResource.value()));
  appointments = computed(() => unwrap<Embedded>(this.appointmentsResource.value()));

  patientCount = computed(() => this.patients().length);
  doctorCount = computed(() => this.doctors().length);
  doctorsAvailable = computed(() => this.doctors().filter(d => d.available).length);

  private now = new Date();

  upcoming = computed<UpcomingRow[]>(() =>
    this.appointments()
      .map(a => ({
        id: a.id,
        when: new Date(`${a.date}T${a.time}`),
        patientName: a.patient
          ? `${a.patient.lastName}, ${a.patient.firstName}`
          : '— removed —',
        doctorName: a.doctor?.name ?? '— removed —',
        status: a.status,
      }))
      .filter(
        r =>
          !Number.isNaN(r.when.getTime()) &&
          r.when.getTime() >= this.now.getTime() &&
          r.status !== 'cancelled',
      )
      .sort((a, b) => a.when.getTime() - b.when.getTime()),
  );

  upcomingCount = computed(() => this.upcoming().length);

  cancelledCount = computed(
    () => this.appointments().filter(a => a.status === 'cancelled').length,
  );

  /** Counts per status, in the canonical status order (not sorted by size). */
  byStatus = computed<StatusDatum[]>(() => {
    const rows = this.appointments();
    const order: AppointmentStatus[] = ['confirmed', 'pending', 'completed', 'cancelled'];
    return order.map(status => ({
      status,
      count: rows.filter(a => a.status === status).length,
    }));
  });

  /**
   * Bookings per calendar day, excluding cancelled.
   *
   * Days with no bookings are emitted as zeros rather than omitted: dropping
   * them would render a quiet weekend as if it never existed and place two
   * non-consecutive days side by side, which misreads as a continuous run.
   */
  byDay = computed<DayDatum[]>(() => {
    const counts = new Map<string, number>();
    for (const a of this.appointments()) {
      if (a.status === 'cancelled' || !a.date) continue;
      counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
    }
    if (!counts.size) return [];

    const days = [...counts.keys()].sort();
    const out: DayDatum[] = [];
    const cursor = new Date(`${days[0]}T00:00:00`);
    const last = new Date(`${days[days.length - 1]}T00:00:00`);

    while (cursor <= last) {
      const iso = toIsoDate(cursor);
      out.push({ date: iso, count: counts.get(iso) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  });

  /** Appointments scheduled for today, whatever their status. */
  todayCount = computed(() => {
    const today = toIsoDate(new Date());
    return this.appointments().filter(a => a.date === today).length;
  });

  /** The soonest upcoming appointment, or null when nothing is scheduled. */
  nextUp = computed<UpcomingRow | null>(() => this.upcoming()[0] ?? null);
}
