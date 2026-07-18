import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { accessGuard } from './core/auth/access.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [authGuard, accessGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'no-access',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/access/no-access.component').then(m => m.NoAccessComponent),
  },
  {
    path: 'blocked',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/access/blocked.component').then(m => m.BlockedComponent),
  },
  {
    path: 'patients',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/patients/patient-list.component').then(m => m.PatientListComponent) },
      { path: 'new', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
    ],
  },
  {
    path: 'doctors',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/doctors/doctor-list.component').then(m => m.DoctorListComponent) },
      { path: 'new', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
      { path: ':id', loadComponent: () => import('./features/doctors/doctor-form.component').then(m => m.DoctorFormComponent) },
    ],
  },
  {
    path: 'appointments',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/appointments/appointment-list.component').then(m => m.AppointmentListComponent) },
      { path: 'new', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
      { path: ':id', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
