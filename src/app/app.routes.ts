import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'patients',
    children: [
      { path: '', loadComponent: () => import('./features/patients/patient-list.component').then(m => m.PatientListComponent) },
      { path: 'new', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
    ],
  },
  {
    path: 'doctors',
    children: [
      { path: '', loadComponent: () => import('./features/doctors/doctor-list.component').then(m => m.DoctorListComponent) },
      { path: 'new', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
      { path: ':id', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
    ],
  },
  {
    path: 'appointments',
    children: [
      { path: '', loadComponent: () => import('./features/appointments/appointment-list.component').then(m => m.AppointmentListComponent) },
      { path: 'new', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
      { path: ':id', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
