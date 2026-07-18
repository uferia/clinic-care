export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24h clock, `HH:mm`. */
  time: string;
  reason: string;
  status: AppointmentStatus;
}

export type CreateAppointmentDto = Omit<Appointment, 'id' | 'clinicId'>;

import { AppointmentRow } from '../../core/db.types';

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    date: row.date,
    time: row.time,
    reason: row.reason ?? '',
    status: row.status as AppointmentStatus,
  };
}

export function toAppointmentWrite(dto: CreateAppointmentDto): Record<string, unknown> {
  return {
    patient_id: dto.patientId,
    doctor_id: dto.doctorId,
    date: dto.date,
    time: dto.time,
    reason: dto.reason,
    status: dto.status,
  };
}

/** An appointment with its patient and doctor names resolved for display. */
export interface AppointmentView extends Appointment {
  patientName: string;
  doctorName: string;
  /** Parsed `date` + `time`; null when either is unset or unparseable. */
  when: Date | null;
}
