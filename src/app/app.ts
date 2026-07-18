import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './core/auth/auth.service';
import { ClinicContextService } from './core/clinic/clinic-context.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DatePipe,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected auth = inject(AuthService);
  protected clinic = inject(ClinicContextService);

  links = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/patients', label: 'Patients', icon: 'groups' },
    { path: '/doctors', label: 'Doctors', icon: 'medical_services' },
    { path: '/appointments', label: 'Appointments', icon: 'event' },
  ];

  logout() {
    this.auth.logout();
  }
}
