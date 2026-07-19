export interface AdminClinic {
  id: string;
  name: string;
  createdAt: string;
  status: 'trialing' | 'active' | 'expired';
  trialEndsAt: string | null;
  activeUntil: string | null;
  memberCount: number;
}

export interface AdminMember {
  id: string;
  email: string;
  role: 'clinic_admin' | 'staff';
  bound: boolean;
}
