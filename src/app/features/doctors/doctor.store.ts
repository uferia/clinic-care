import { computed, inject, resource, Service, signal } from '@angular/core';
import { Doctor, toDoctor } from './doctor.model';
import { SUPABASE } from '../../core/supabase.client';

/** Escape PostgREST `or()` separators so a typed comma/paren can't break the filter. */
function escapeIlike(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

@Service()
export class DoctorStore {
  private supabase = inject(SUPABASE);

  readonly pageSize = 6;

  private _page = signal(1);
  private _searchInput = signal('');
  private _search = signal('');
  private _specialty = signal<string>('');
  private _availableOnly = signal(false);

  page = this._page.asReadonly();
  searchInput = this._searchInput.asReadonly();
  specialty = this._specialty.asReadonly();
  availableOnly = this._availableOnly.asReadonly();

  private debounceTimer?: ReturnType<typeof setTimeout>;
  setSearch(q: string) {
    this._searchInput.set(q);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this._search.set(q);
      this._page.set(1);
    }, 300);
  }

  setSpecialty(s: string) {
    this._specialty.set(s);
    this._page.set(1);
  }

  setAvailableOnly(v: boolean) {
    this._availableOnly.set(v);
    this._page.set(1);
  }

  setPage(p: number) {
    this._page.set(p);
  }

  private doctorsResource = resource({
    params: () => ({
      page: this._page(),
      search: this._search().trim(),
      specialty: this._specialty(),
      availableOnly: this._availableOnly(),
    }),
    loader: async ({ params }) => {
      let query = this.supabase.from('doctors').select('*', { count: 'exact' });

      if (params.search) {
        const q = escapeIlike(params.search);
        query = query.or(`name.ilike.%${q}%,specialty.ilike.%${q}%`);
      }
      if (params.specialty) query = query.eq('specialty', params.specialty);
      if (params.availableOnly) query = query.eq('available', true);

      const from = (params.page - 1) * this.pageSize;
      query = query.range(from, from + this.pageSize - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []).map(toDoctor), total: count ?? 0 };
    },
  });

  doctors = computed<Doctor[]>(() => this.doctorsResource.value()?.rows ?? []);
  total = computed(() => this.doctorsResource.value()?.total ?? 0);

  readonly isLoading = computed(() => this.doctorsResource.isLoading());
  readonly error = computed(() => this.doctorsResource.error());
  reload() {
    this.doctorsResource.reload();
  }

  private _deleted = signal<Set<string>>(new Set());
  visibleDoctors = computed(() =>
    this.doctors().filter(d => !this._deleted().has(d.id)),
  );

  remove(id: string) {
    this._deleted.update(s => new Set(s).add(id));
    this.supabase
      .from('doctors')
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
          this.doctorsResource.reload();
        }
      });
  }
}
