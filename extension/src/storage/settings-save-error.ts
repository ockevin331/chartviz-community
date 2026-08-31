export type SettingsSaveFailureReason =
  | 'config_superseded'
  | 'mode_transition_superseded'
  | 'mode_persistence_superseded'
  | 'runtime_transition_superseded';

export class SettingsSaveError extends Error {
  constructor(readonly reason: SettingsSaveFailureReason) {
    super(`settings_save_failed:${reason}`);
    this.name = 'SettingsSaveError';
  }
}
