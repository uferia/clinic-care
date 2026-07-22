import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { accessGuard } from './core/auth/access.guard';
import { superAdminGuard } from './core/auth/super-admin.guard';
import { clinicAdminGuard } from './core/auth/clinic-admin.guard';

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
      { path: ':id/edit', loadComponent: () => import('./features/patients/patient-form.component').then(m => m.PatientFormComponent) },
      { path: ':id', loadComponent: () => import('./features/patients/patient-detail.component').then(m => m.PatientDetailComponent) },
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
      { path: 'calendar', loadComponent: () => import('./features/appointments/appointment-calendar.component').then(m => m.AppointmentCalendarComponent) },
      { path: 'new', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
      { path: ':id', loadComponent: () => import('./features/appointments/appointment-form.component').then(m => m.AppointmentFormComponent) },
    ],
  },
  {
    path: 'billing',
    canActivate: [authGuard, accessGuard],
    children: [
      { path: '', loadComponent: () => import('./features/billing/invoice-list.component').then(m => m.InvoiceListComponent) },
      { path: 'new', loadComponent: () => import('./features/billing/invoice-form.component').then(m => m.InvoiceFormComponent) },
      { path: 'catalog', loadComponent: () => import('./features/billing/service-list.component').then(m => m.ServiceListComponent) },
      { path: 'reports', loadComponent: () => import('./features/billing/billing-reports.component').then(m => m.BillingReportsComponent) },
      { path: 'settings', loadComponent: () => import('./features/billing/billing-settings.component').then(m => m.BillingSettingsComponent) },
      { path: ':id', loadComponent: () => import('./features/billing/invoice-detail.component').then(m => m.InvoiceDetailComponent) },
    ],
  },
  {
    path: 'clinic',
    canActivate: [authGuard, accessGuard, clinicAdminGuard],
    loadComponent: () =>
      import('./features/clinic/clinic-settings.component').then(m => m.ClinicSettingsComponent),
  },
  // Team moved under the clinic page; keep the old path working for bookmarks.
  { path: 'team', redirectTo: 'clinic', pathMatch: 'full' },
  {
    path: 'admin',
    canActivate: [authGuard, superAdminGuard],
    children: [
      { path: '', loadComponent: () => import('./features/admin/admin-clinics.component').then(m => m.AdminClinicsComponent) },
      { path: ':id', loadComponent: () => import('./features/admin/admin-clinic-detail.component').then(m => m.AdminClinicDetailComponent) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
