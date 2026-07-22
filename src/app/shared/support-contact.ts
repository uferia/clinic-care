import { environment } from '../../environments/environment';

/** Where a clinic goes to arrange or renew a paid subscription. */
export const supportEmail = environment.supportEmail;

/**
 * A mailto link that arrives with the clinic already identified, so the owner
 * does not have to ask "which clinic is this?" before they can activate it.
 */
export function activationMailto(clinicName: string): string {
  const subject = `Activate subscription — ${clinicName}`;
  return `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}`;
}
