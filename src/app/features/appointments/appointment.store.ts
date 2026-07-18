import { computed, inject, resource, Service, signal } from '@angular/core';
import { AppointmentStatus, AppointmentView } from './appointment.model';
import { AppointmentRowEmbedded } from '../../core/db.types';
import { SUPABASE } from '../../core/supabase.client';

const EMBED = '*, patient:patients(*), doctor:doctors(*)';

function toDate(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Service()
export class AppointmentStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 8;

  private _page = signal(1);
  private _status = signal<string>('');

  page = this._page.asReadonly();
  status = this._status.asReadonly();

  setStatus(s: string) {
    this._status.set(s);
    this._page.set(1);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private appointmentsResource = resource({
    params: () => ({ page: this._page(), status: this._status() }),
    loader: async ({ params }) => {
      let query = this.supabase
        .from('appointments')
        .select(EMBED, { count: 'exact' })
        .order('date')
        .order('time');

      if (params.status) query = query.eq('status', params.status);

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as AppointmentRowEmbedded[], total: count ?? 0 };
    },
  });

  private rows = computed(() => this.appointmentsResource.value()?.rows ?? []);
  total = computed(() => this.appointmentsResource.value()?.total ?? 0);

  appointments = computed<AppointmentView[]>(() =>
    this.rows().map(a => ({
      id: a.id,
      clinicId: a.clinic_id,
      patientId: a.patient_id,
      doctorId: a.doctor_id,
      date: a.date,
      time: a.time,
      reason: a.reason ?? '',
      status: a.status as AppointmentStatus,
      patientName: a.patient
        ? `${a.patient.last_name}, ${a.patient.first_name}`
        : '— removed —',
      doctorName: a.doctor?.name ?? '— removed —',
      when: toDate(a.date, a.time),
    })),
  );

  readonly isLoading = computed(() => this.appointmentsResource.isLoading());
  readonly error = computed(() => this.appointmentsResource.error());
  reload() {
    this.appointmentsResource.reload();
  }

  private _busy = signal<Set<string>>(new Set());
  busy = this._busy.asReadonly();

  private markBusy(id: string, on: boolean) {
    this._busy.update(s => {
      const next = new Set(s);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  setStatusOf(id: string, status: AppointmentStatus) {
    this.markBusy(id, true);
    this.supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (!error) this.appointmentsResource.reload();
        this.markBusy(id, false);
      });
  }

  remove(id: string) {
    this.markBusy(id, true);
    this.supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (!error) this.appointmentsResource.reload();
        this.markBusy(id, false);
      });
  }
}
