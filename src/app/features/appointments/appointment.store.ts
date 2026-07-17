import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Appointment, AppointmentStatus, AppointmentView } from './appointment.model';
import { Patient } from '../patients/patient.model';
import { Doctor } from '../doctors/doctor.model';
import { API } from '../../core/api';

/** Shape json-server returns for `_embed=patient&_embed=doctor`. */
type EmbeddedAppointment = Appointment & {
  patient?: Patient | null;
  doctor?: Doctor | null;
};

function toDate(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Service()
export class AppointmentStore {
  private http = inject(HttpClient);

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

  appointmentsResource = httpResource<EmbeddedAppointment[]>(() => {
    const params = new URLSearchParams({
      _page: String(this._page()),
      _per_page: String(this.pageSize),
      _sort: 'date,time',
    });
    params.append('_embed', 'patient');
    params.append('_embed', 'doctor');

    if (this._status()) {
      params.set('_where', JSON.stringify({ status: { eq: this._status() } }));
    }

    return `${API}/appointments?${params}`;
  });

  private rows = computed(() => {
    const raw = this.appointmentsResource.value() as any;
    return (raw?.data ?? raw ?? []) as EmbeddedAppointment[];
  });

  total = computed(() => {
    const raw = this.appointmentsResource.value() as any;
    return (raw?.items ?? this.rows().length) as number;
  });

  appointments = computed<AppointmentView[]>(() =>
    this.rows().map(a => ({
      ...a,
      // A patient deleted through the UI leaves patientId null on its
      // appointments — json-server nulls the FK rather than blocking.
      patientName: a.patient
        ? `${a.patient.lastName}, ${a.patient.firstName}`
        : '— removed —',
      doctorName: a.doctor?.name ?? '— removed —',
      when: toDate(a.date, a.time),
    })),
  );

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
    this.http.patch(`${API}/appointments/${id}`, { status }).subscribe({
      next: () => {
        this.appointmentsResource.reload();
        this.markBusy(id, false);
      },
      error: () => this.markBusy(id, false),
    });
  }

  remove(id: string) {
    this.markBusy(id, true);
    this.http.delete(`${API}/appointments/${id}`).subscribe({
      next: () => {
        this.appointmentsResource.reload();
        this.markBusy(id, false);
      },
      error: () => this.markBusy(id, false),
    });
  }
}
