import { HttpClient, httpResource } from "@angular/common/http";
import { computed, inject, Service, signal } from "@angular/core";
import { Patient } from "./patient.model";

@Service()
export class PatientStore {
    private http = inject(HttpClient);
    
    private _page = signal(1);
    private _searchInput = signal('');
    private _search = signal('');

    page = this._page.asReadonly();
    searchInput = this._searchInput.asReadonly();

    private debounceTimer?: ReturnType<typeof setTimeout>;
    setSearch(q: string){
        this._searchInput.set(q);
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this._search.set(q);
            this._page.set(1);
        }, 300);
    }
    setPage(p: number){
        this._page.set(p);
    }

    readonly pageSize = 5;

    patientsResource = httpResource<Patient[]>(() => {
    const params = new URLSearchParams({
      _page: String(this._page()),
      _per_page: String(this.pageSize),
    });
    const q = this._search().trim();
    // json-server v1 dropped `q` full-text search and `_like`. `_where` with
    // nested `contains` is the only substring match it still supports.
    if (q) {
      params.set('_where', JSON.stringify({
        or: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { phone: { contains: q } },
        ],
      }));
    }
    return `http://localhost:3000/patients?${params}`;
  });

  patients = computed(() => {
    const raw = this.patientsResource.value() as any;
    return (raw?.data ?? raw ?? []) as Patient[];
  })

  // json-server returns `items` (total matching rows) alongside `data`.
  total = computed(() => {
    const raw = this.patientsResource.value() as any;
    return (raw?.items ?? this.patients().length) as number;
  })

  private _deleted = signal<Set<string>>(new Set());
  visiblePatients = computed(() =>
    this.patients().filter(p => !this._deleted().has(p.id))
  );

  remove(id: string){
    this._deleted.update(s => new Set(s).add(id));
    this.http.delete(`http://localhost:3000/patients/${id}`).subscribe({
        next: () => this.patientsResource.reload(),
        error: () => this._deleted.update(s => {
            const next = new Set(s);
            next.delete(id);
            return next;
        }),
    });
  }
}