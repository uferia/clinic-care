import { computed, inject, resource, Service, signal } from '@angular/core';
import { SUPABASE } from '../../core/supabase.client';
import { ClinicalNote, CreateNoteDto, toClinicalNote, toNoteWrite } from './clinical-note.model';

@Service()
export class ClinicalNotesStore {
  private supabase = inject(SUPABASE);
  private _patientId = signal<string | null>(null);

  setPatient(id: string) {
    this._patientId.set(id);
  }

  private notesResource = resource({
    params: () => ({ patientId: this._patientId() }),
    loader: async ({ params }) => {
      if (!params.patientId) return [] as ClinicalNote[];
      const { data, error } = await this.supabase
        .from('patient_clinical_notes')
        .select('*')
        .eq('patient_id', params.patientId)
        .order('visit_date', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toClinicalNote);
    },
  });

  notes = computed<ClinicalNote[]>(() => this.notesResource.value() ?? []);
  readonly isLoading = computed(() => this.notesResource.isLoading());
  readonly error = computed(() => this.notesResource.error());

  async add(dto: CreateNoteDto): Promise<void> {
    const { error } = await this.supabase.from('patient_clinical_notes').insert(toNoteWrite(dto));
    if (error) throw error;
    this.notesResource.reload();
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('patient_clinical_notes').delete().eq('id', id);
    if (error) throw error;
    this.notesResource.reload();
  }
}
