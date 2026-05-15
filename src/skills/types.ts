export interface SkillMeta {
  /** Unique identifier, used in URI skill://{name} */
  name: string;
  /** Human-readable title shown in skill listings */
  title: string;
  /** Short description of what the skill provides */
  description: string;
  /** Optional grouping category */
  category?: string;
}

export interface Skill extends SkillMeta {
  /** The instruction/constraint content (markdown) */
  content: string;
}
