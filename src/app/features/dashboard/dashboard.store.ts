import { computed, inject, resource, Service } from '@angular/core';
import { AppointmentStatus } from '../appointments/appointment.model';
import { Patient, toPatient } from '../patients/patient.model';
import { Doctor, toDoctor } from '../doctors/doctor.model';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { SUPABASE } from '../../core/supabase.client';

export interface StatusDatum { status: AppointmentStatus; count: number; }
export interface DayDatum { date: string; count: number; }
export interface UpcomingRow {
  id: string; when: Date; patientName: string; doctorName: string; status: AppointmentStatus;
}

/** Local `YYYY-MM-DD`. Avoids toISOString(), which shifts across the date line. */
function toIsoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

@Service()
export class DashboardStore {
  private supabase = inject(SUPABASE);

  private patientsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase.from('patients').select('*');
      if (error) throw error;
      return (data ?? []).map(toPatient);
    },
  });
  private doctorsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase.from('doctors').select('*');
      if (error) throw error;
      return (data ?? []).map(toDoctor);
    },
  });
  private appointmentsResource = resource({
    loader: async () => {
      const { data, error } = await this.supabase
        .from('appointments')
        .select('*, patient:patients(*), doctor:doctors(*)');
      if (error) throw error;
      return (data ?? []) as AppointmentRowEmbedded[];
    },
  });

  isLoading = computed(() =>
    this.patientsResource.isLoading() ||
    this.doctorsResource.isLoading() ||
    this.appointmentsResource.isLoading(),
  );

  error = computed(() =>
    this.patientsResource.error() ??
    this.doctorsResource.error() ??
    this.appointmentsResource.error(),
  );

  reload() {
    this.patientsResource.reload();
    this.doctorsResource.reload();
    this.appointmentsResource.reload();
  }

  patients = computed<Patient[]>(() => this.patientsResource.value() ?? []);
  doctors = computed<Doctor[]>(() => this.doctorsResource.value() ?? []);
  private apptRows = computed<AppointmentRowEmbedded[]>(() => this.appointmentsResource.value() ?? []);

  // Compatibility for the dashboard component, which reads the raw appointment
  // rows for a total count; the row shape itself is otherwise private.
  appointments = computed(() => this.apptRows());

  patientCount = computed(() => this.patients().length);
  doctorCount = computed(() => this.doctors().length);
  doctorsAvailable = computed(() => this.doctors().filter(d => d.available).length);

  private now = new Date();

  upcoming = computed<UpcomingRow[]>(() =>
    this.apptRows()
      .map(a => ({
        id: a.id,
        when: new Date(`${a.date}T${a.time}`),
        patientName: a.patient
          ? `${a.patient.last_name}, ${a.patient.first_name}`
          : '— removed —',
        doctorName: a.doctor?.name ?? '— removed —',
        status: a.status as AppointmentStatus,
      }))
      .filter(r =>
        !Number.isNaN(r.when.getTime()) &&
        r.when.getTime() >= this.now.getTime() &&
        r.status !== 'cancelled',
      )
      .sort((a, b) => a.when.getTime() - b.when.getTime()),
  );

  upcomingCount = computed(() => this.upcoming().length);

  cancelledCount = computed(() =>
    this.apptRows().filter(a => a.status === 'cancelled').length,
  );

  /** Counts per status, in the canonical status order (not sorted by size). */
  byStatus = computed<StatusDatum[]>(() => {
    const rows = this.apptRows();
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
    for (const a of this.apptRows()) {
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
    return this.apptRows().filter(a => a.date === today).length;
  });

  /** The soonest upcoming appointment, or null when nothing is scheduled. */
  nextUp = computed<UpcomingRow | null>(() => this.upcoming()[0] ?? null);
}
