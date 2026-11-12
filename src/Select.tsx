import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './select.css';

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>;
type Choice = { value: string; label: string; disabled: boolean; group?: string };

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join('');
}

function choicesFrom(children: ReactNode, group?: string, disabled = false): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
        hidden?: boolean;
      }>(child)
    )
      return [];
    const props = child.props;
    if (child.type === 'option') {
      if (props.hidden) return [];
      return [
        {
          value: String(props.value ?? textContent(props.children)),
          label: props.label ?? textContent(props.children),
          disabled: disabled || !!props.disabled,
          group,
        },
      ];
    }
    return choicesFrom(
      props.children,
      child.type === 'optgroup' ? props.label : group,
      disabled || !!props.disabled,
    );
  });
}

/** A single-value select with a themed popup and a native form/event bridge. */
export function Select({ children, className = '', style, onChange, id, ...props }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [uncontrolled, setUncontrolled] = useState(String(props.defaultValue ?? ''));
  const [fieldLabel, setFieldLabel] = useState('');
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 300 });
  const choices = choicesFrom(children);
  const value = props.value === undefined ? uncontrolled : String(props.value);
  const selected = choices.findIndex((option) => option.value === value);
  const fallback = choices.findIndex((option) => !option.disabled);
  const current = choices[selected] ?? choices[Math.max(0, fallback)];

  useLayoutEffect(() => {
    // Fields use implicit labels. Keep their short title as the combobox name,
    // excluding option text and optional help copy.
    const label = trigger.current?.closest('label');
    if (label) {
      const clone = label.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.launcher-select, small').forEach((node) => node.remove());
      setFieldLabel(clone.textContent?.trim() ?? '');
    }
    if (props.value === undefined && native.current) setUncontrolled(native.current.value);
  }, [children, props.value]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const desired = Math.min(310, choices.length * 38 + 12);
      const upward = below < desired && above > below;
      const maxHeight = Math.max(38, Math.min(310, upward ? above : below));
      const width = Math.min(Math.max(rect.width, 150), window.innerWidth - 24);
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upward ? Math.max(12, rect.top - Math.min(desired, maxHeight) - 6) : rect.bottom + 6,
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, choices.length]);

  useEffect(() => {
    if (open)
      menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  const show = () => {
    setActive(selected >= 0 && !choices[selected].disabled ? selected : fallback);
    setOpen(true);
  };
  const choose = (index: number) => {
    const choice = choices[index];
    if (!choice || choice.disabled || !native.current) return;
    native.current.value = choice.value;
    native.current.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false);
    trigger.current?.focus();
  };
  const move = (direction: number) => {
    let next = active;
    for (let count = 0; count < choices.length; count++) {
      next = (next + direction + choices.length) % choices.length;
      if (!choices[next].disabled) {
        setActive(next);
        break;
      }
    }
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) show();
      else if (event.key === 'Enter' || event.key === ' ') choose(active);
      else if (event.key === 'Home') setActive(fallback);
      else if (event.key === 'End') {
        for (let index = choices.length - 1; index >= 0; index--) {
          if (!choices[index].disabled) {
            setActive(index);
            break;
          }
        }
      } else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      search.current.text =
        (now - search.current.at < 600 ? search.current.text : '') + event.key.toLocaleLowerCase();
      search.current.at = now;
      const next = choices.findIndex(
        (option) =>
          !option.disabled && option.label.toLocaleLowerCase().startsWith(search.current.text),
      );
      if (!open) show();
      if (next >= 0) setActive(next);
    }
  };
  const label = props['aria-label'] ?? (fieldLabel || undefined);
  return (
    <span className={`launcher-select ${className}`} style={style}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className="launcher-select-trigger"
        role="combobox"
        aria-label={label}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        aria-required={props.required}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={props.disabled}
        title={props.title ?? current?.label}
        autoFocus={props.autoFocus}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keyboard}
        onBlur={() => setOpen(false)}
      >
        <span>{current?.label ?? '无可选项'}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <select
        {...props}
        ref={native}
        className="launcher-select-native"
        aria-hidden="true"
        tabIndex={-1}
        autoFocus={false}
        onChange={(event) => {
          setUncontrolled(event.target.value);
          onChange?.(event);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          trigger.current?.focus();
          show();
          props.onInvalid?.(event);
        }}
      >
        {children}
      </select>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={label}
            className="launcher-select-menu"
            style={position}
            onMouseDown={(event) => event.preventDefault()}
          >
            {choices.map((option, index) => (
              <div
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === current?.value}
                aria-disabled={option.disabled || undefined}
                className={'launcher-select-option' + (active === index ? ' highlighted' : '')}
                data-value={option.value}
                data-index={index}
                title={option.label}
                onPointerMove={() => !option.disabled && setActive(index)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(index);
                }}
              >
                <span>
                  {option.label}
                  {option.group && <small>{option.group}</small>}
                </span>
                {option.value === current?.value && <Check size={14} aria-hidden="true" />}
              </div>
            ))}
            {!choices.length && (
              <div className="launcher-select-option" aria-disabled="true">
                无可选项
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
