import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { toIsoDate } from '../../core/date.util';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { AppointmentStatus, AppointmentView } from './appointment.model';

const EMBED = '*, patient:patients(*), doctor:doctors(*)';

export interface CalendarDay {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  appointments: AppointmentView[];
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The list view pages eight rows at a time; a month grid needs the whole month
 * at once, so this fetches by date range instead of by page.
 */
@Service()
export class AppointmentCalendarStore {
  private supabase = inject(SUPABASE);

  private _month = signal(startOfMonth(new Date()));
  month = this._month.asReadonly();

  setMonth(d: Date) { this._month.set(startOfMonth(d)); }
  today() { this.setMonth(new Date()); }
  next() { const m = this._month(); this.setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1)); }
  previous() { const m = this._month(); this.setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1)); }

  /**
   * The grid always shows whole weeks, so it spills into the neighbouring
   * months — fetch that same span, or trailing days would look empty.
   */
  private gridStart = computed(() => {
    const first = this._month();
    return new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  });

  private gridEnd = computed(() => {
    const start = this.gridStart();
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
  });

  private appointmentsResource = resource({
    params: () => ({ from: toIsoDate(this.gridStart()), to: toIsoDate(this.gridEnd()) }),
    loader: async ({ params }) => {
      const { data, error } = await this.supabase
        .from('appointments')
        .select(EMBED)
        .gte('date', params.from)
        .lte('date', params.to)
        .order('date')
        .order('time');
      if (error) throw error;
      return (data ?? []) as AppointmentRowEmbedded[];
    },
  });

  readonly isLoading = computed(() => this.appointmentsResource.isLoading());
  readonly error = computed(() => this.appointmentsResource.error());
  reload() { this.appointmentsResource.reload(); }

  private appointments = computed<AppointmentView[]>(() => {
    const rows = this.appointmentsResource.hasValue() ? this.appointmentsResource.value() : [];
    return rows.map((a: any): AppointmentView => ({
      id: a.id,
      clinicId: a.clinic_id,
      patientId: a.patient_id,
      doctorId: a.doctor_id,
      date: a.date,
      time: a.time,
      reason: a.reason ?? '',
      status: a.status as AppointmentStatus,
      patientName: a.patient ? `${a.patient.first_name} ${a.patient.last_name}` : '',
      doctorName: a.doctor?.name ?? '',
      when: a.date && a.time ? new Date(`${a.date}T${a.time}`) : null,
    }));
  });

  /** Six weeks of days, so the grid height never jumps between months. */
  days = computed<CalendarDay[]>(() => {
    const start = this.gridStart();
    const monthIndex = this._month().getMonth();
    const todayIso = toIsoDate(new Date());

    const byDay = new Map<string, AppointmentView[]>();
    for (const a of this.appointments()) {
      const list = byDay.get(a.date);
      if (list) list.push(a); else byDay.set(a.date, [a]);
    }

    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toIsoDate(date);
      return {
        date,
        iso,
        inMonth: date.getMonth() === monthIndex,
        isToday: iso === todayIso,
        appointments: byDay.get(iso) ?? [],
      };
    });
  });

  readonly monthTotal = computed(() =>
    this.days().filter(d => d.inMonth).reduce((sum, d) => sum + d.appointments.length, 0),
  );
}
