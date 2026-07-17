import { HttpClient, httpResource } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Doctor } from './doctor.model';
import { API } from '../../core/api';

@Service()
export class DoctorStore {
  private http = inject(HttpClient);

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

  doctorsResource = httpResource<Doctor[]>(() => {
    const params = new URLSearchParams({
      _page: String(this._page()),
      _per_page: String(this.pageSize),
    });

    // json-server v1 `_where`: sibling keys are ANDed implicitly — there is no
    // `and` operator. `or` is the one special key and may sit alongside them.
    const where: Record<string, unknown> = {};
    const q = this._search().trim();
    if (q) {
      where['or'] = [
        { name: { contains: q } },
        { specialty: { contains: q } },
      ];
    }
    if (this._specialty()) where['specialty'] = { eq: this._specialty() };
    if (this._availableOnly()) where['available'] = { eq: true };

    if (Object.keys(where).length) params.set('_where', JSON.stringify(where));

    return `${API}/doctors?${params}`;
  });

  doctors = computed(() => {
    const raw = this.doctorsResource.value() as any;
    return (raw?.data ?? raw ?? []) as Doctor[];
  });

  total = computed(() => {
    const raw = this.doctorsResource.value() as any;
    return (raw?.items ?? this.doctors().length) as number;
  });

  private _deleted = signal<Set<string>>(new Set());
  visibleDoctors = computed(() =>
    this.doctors().filter(d => !this._deleted().has(d.id)),
  );

  remove(id: string) {
    this._deleted.update(s => new Set(s).add(id));
    this.http.delete(`${API}/doctors/${id}`).subscribe({
      next: () => {
        this.doctorsResource.reload();
        this._deleted.update(s => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      },
      error: () =>
        this._deleted.update(s => {
          const next = new Set(s);
          next.delete(id);
          return next;
        }),
    });
  }
}
