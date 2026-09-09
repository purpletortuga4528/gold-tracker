import { useAppearance } from '../lib/useTheme.jsx';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', glyph: '☀' },
  { value: 'dark', label: 'Dark', glyph: '☾' },
  { value: 'system', label: 'System', glyph: '◐' },
];

function SegmentedControl({ legend, options, value, onChange, renderOption }) {
  return (
    <fieldset className="flex items-center gap-1 rounded-lg border border-line bg-raised p-0.5">
      <legend className="sr-only">{legend}</legend>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.title ?? opt.label}
            className={`rounded-md px-2 py-1 text-xs font-medium transition ${
              active
                ? 'bg-accent text-on-accent'
                : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {renderOption(opt)}
          </button>
        );
      })}
    </fieldset>
  );
}

export function AppearanceControls() {
  const { theme, setTheme, font, setFont, contrast, setContrast } = useAppearance();

  const fontOptions = [
    {
      value: 'default',
      label: 'Aa',
      title: 'System typeface',
    },
    {
      value: 'hyperlegible',
      label: 'Aa',
      title:
        'Atkinson Hyperlegible Next: letterforms drawn so that easily confused characters stay distinct',
    },
  ];

  const contrastOptions = [
    { value: 'normal', label: 'Normal contrast', glyph: '◐' },
    {
      value: 'high',
      label: 'High contrast',
      glyph: '◉',
      title: 'High contrast: pure grounds, full-strength text and solid borders',
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <SegmentedControl
        legend="Colour theme"
        options={THEME_OPTIONS}
        value={theme}
        onChange={setTheme}
        renderOption={(opt) => (
          <>
            <span aria-hidden="true">{opt.glyph}</span>
            <span className="sr-only">{opt.label}</span>
          </>
        )}
      />

      <SegmentedControl
        legend="Contrast"
        options={contrastOptions}
        value={contrast}
        onChange={setContrast}
        renderOption={(opt) => (
          <>
            <span aria-hidden="true">{opt.glyph}</span>
            <span className="sr-only">{opt.label}</span>
          </>
        )}
      />

      <SegmentedControl
        legend="Typeface"
        options={fontOptions}
        value={font}
        onChange={setFont}
        renderOption={(opt) => (
          <>
            {/* The hyperlegible option is set in the face it switches to, so the
                control previews the change rather than just describing it. */}
            <span
              aria-hidden="true"
              style={
                opt.value === 'hyperlegible'
                  ? { fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif" }
                  : undefined
              }
            >
              {opt.label}
            </span>
            <span className="sr-only">{opt.title}</span>
          </>
        )}
      />
    </div>
  );
}
