export interface SkillMeta {
  /** Unique identifier, used in URI skill://{name} */
  name: string;
  /** Human-readable title shown in skill listings */
  title: string;
  /** Short description of what the skill provides */
  description: string;
  /** Optional grouping category */
  category?: string;
  /** Short trigger guidance for AI agents — when to use this skill (1-2 sentences) */
  instructions?: string;
  /** Trigger keywords/phrases that map to this skill */
  triggers?: string[];
}

export interface Skill extends SkillMeta {
  /** The instruction/constraint content (markdown) */
  content: string;
}
