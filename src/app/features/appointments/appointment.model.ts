export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  /** 24h clock, `HH:mm`. */
  time: string;
  reason: string;
  status: AppointmentStatus;
}

export type CreateAppointmentDto = Omit<Appointment, 'id'>;

/** An appointment with its patient and doctor names resolved for display. */
export interface AppointmentView extends Appointment {
  patientName: string;
  doctorName: string;
  /** Parsed `date` + `time`; null when either is unset or unparseable. */
  when: Date | null;
}
