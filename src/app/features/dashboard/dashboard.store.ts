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

  /** Bookings per calendar day, chronological, excluding cancelled. */
  byDay = computed<DayDatum[]>(() => {
    const counts = new Map<string, number>();
    for (const a of this.appointments()) {
      if (a.status === 'cancelled') continue;
      if (!a.date) continue;
      counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}
