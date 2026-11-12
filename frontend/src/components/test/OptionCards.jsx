import './OptionCards.css';

export const LETTERS = 'ABCDEFGH';

/**
 * Multiple-choice options as cards (handoff screen 07, components sheet
 * "Option card"): native radios, so arrow keys move between options and
 * the group is named by the question. The selected card takes the accent
 * border and wash and a filled letter; it is also marked by the checked
 * radio, not by colour alone.
 */
export function OptionCards({ name, labelledBy, options, value, onChange, disabled = false }) {
  return (
    <div className="rf-options" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option, i) => {
        const checked = value === option;
        return (
          <label key={option} className="rf-option" data-checked={checked || undefined}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
            <span className="rf-option__letter" aria-hidden="true">{LETTERS[i]}</span>
            <span className="rf-option__text">{option}</span>
          </label>
        );
      })}
    </div>
  );
}
