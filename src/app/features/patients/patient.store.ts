import { computed, inject, resource, Service, signal } from '@angular/core';
import { Patient, toPatient, MedicalBackground, toMedicalWrite } from './patient.model';
import { toPhoneSearchTerm } from './phone.util';
import { SUPABASE } from '../../core/supabase.client';

/** Escape PostgREST `or()` separators so a typed comma/paren can't break the filter. */
function escapeIlike(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

@Service()
export class PatientStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 5;

  private _page = signal(1);
  private _searchInput = signal('');
  private _search = signal('');

  page = this._page.asReadonly();
  searchInput = this._searchInput.asReadonly();

  private debounceTimer?: ReturnType<typeof setTimeout>;
  setSearch(q: string) {
    this._searchInput.set(q);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._search.set(q);
      this._page.set(1);
    }, 300);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private patientsResource = resource({
    params: () => ({ page: this._page(), search: this._search().trim() }),
    loader: async ({ params }) => {
      let query = this.supabase.from('patients').select('*', { count: 'exact' });

      if (params.search) {
        const q = escapeIlike(params.search);
        const ors = [`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`];
        const phone = toPhoneSearchTerm(params.search);
        if (phone) ors.push(`phone.ilike.%${phone}%`);
        query = query.or(ors.join(','));
      }

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []).map(toPatient), total: count ?? 0 };
    },
  });

  patients = computed<Patient[]>(() => this.patientsResource.value()?.rows ?? []);
  total = computed(() => this.patientsResource.value()?.total ?? 0);

  readonly isLoading = computed(() => this.patientsResource.isLoading());
  readonly error = computed(() => this.patientsResource.error());
  reload() {
    this.patientsResource.reload();
  }

  private _deleted = signal<Set<string>>(new Set());
  visiblePatients = computed(() =>
    this.patients().filter(p => !this._deleted().has(p.id)),
  );

  remove(id: string) {
    this._deleted.update(s => new Set(s).add(id));
    this.supabase
      .from('patients')
      .delete()
      .eq('id', id)
      .then(({ error }: { error: unknown }) => {
        if (error) {
          this._deleted.update(s => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        } else {
          this.patientsResource.reload();
        }
      });
  }

  async getById(id: string): Promise<Patient | null> {
    const { data, error } = await this.supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? toPatient(data) : null;
  }

  async saveMedical(id: string, m: MedicalBackground): Promise<void> {
    const { error } = await this.supabase.from('patients').update(toMedicalWrite(m)).eq('id', id);
    if (error) throw error;
  }
}
