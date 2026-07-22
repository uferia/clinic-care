import { describe as describeEntry, ActivityEntry } from './activity.store';

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 'a1',
    actorEmail: 'owner@x.com',
    action: 'member.remove',
    target: 'nurse@x.com',
    details: {},
    createdAt: '2026-07-22T00:00:00Z',
    ...over,
  };
}

describe('describe', () => {
  it('reads as a sentence about a person, not an action key', () => {
    expect(describeEntry(entry({}))).toBe('removed nurse@x.com');
  });

  it('names the new role on a role change', () => {
    const text = describeEntry(entry({ action: 'member.role_change', details: { role: 'clinic_admin' } }));
    expect(text).toBe('changed the role of nurse@x.com to clinic_admin');
  });

  it('names the role an invite was sent as', () => {
    const text = describeEntry(entry({ action: 'member.invite', target: 'new@x.com', details: { role: 'staff' } }));
    expect(text).toBe('invited new@x.com as staff');
  });

  it('spells out a rename, which is the profile change worth explaining later', () => {
    const text = describeEntry(entry({
      action: 'clinic.update', target: 'Sunrise Family Clinic',
      details: { previous_name: 'Sunrise Clinic' },
    }));
    expect(text).toBe('renamed the clinic from Sunrise Clinic to Sunrise Family Clinic');
  });

  it('does not claim a rename when only other fields changed', () => {
    const text = describeEntry(entry({
      action: 'clinic.update', target: 'Sunrise Clinic',
      details: { previous_name: 'Sunrise Clinic' },
    }));
    expect(text).toBe('updated the clinic profile Sunrise Clinic');
  });

  it('names the clinic on registration, not the registrant email in the target', () => {
    const text = describeEntry(entry({
      action: 'clinic.register', target: 'owner@x.com', details: { name: 'Sunrise Clinic' },
    }));
    expect(text).toBe('registered the clinic Sunrise Clinic');
  });

  it('falls back to the raw action rather than inventing wording', () => {
    expect(describeEntry(entry({ action: 'something.new', target: '' }))).toBe('something.new');
  });
});
