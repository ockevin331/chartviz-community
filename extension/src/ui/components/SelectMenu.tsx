import { Fragment, useEffect, useId, useRef, useState } from 'react';

export type SelectOption<T extends string> = Readonly<{
  value: T;
  label: string;
  group?: string;
  description?: string;
  badge?: string;
}>;

type Props<T extends string> = {
  ariaLabel: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange(value: T): void;
};

export function SelectMenu<T extends string>({ ariaLabel, value, options, onChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return <div className="select-menu" ref={rootRef}>
    <button
      type="button"
      className="select-menu-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(true);
        }
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <span>{selected?.label ?? ''}</span><span className="select-menu-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="select-menu-options" id={listboxId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <Fragment key={option.value}>
        {option.group && option.group !== options[index - 1]?.group && <div className="select-menu-group" role="presentation">{option.group}</div>}
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? 'selected' : undefined}
          onClick={() => { onChange(option.value); setOpen(false); }}
        >
          <span className="select-menu-option-copy">
            <span className="select-menu-option-title">{option.label}{option.badge && <small className="select-menu-option-badge">{option.badge}</small>}</span>
            {option.description && <small className="select-menu-option-description">{option.description}</small>}
          </span>
          <span className="select-menu-check" aria-hidden="true">{option.value === value ? '✓' : ''}</span>
        </button>
      </Fragment>)}
    </div>}
  </div>;
}
