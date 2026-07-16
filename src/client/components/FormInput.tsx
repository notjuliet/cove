import { Show } from "solid-js";

import { controlClass } from "../lib/ui";

export function FormInput(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  maskedPlaceholder?: boolean;
  autocomplete?: string;
  inputMode?: "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
}) {
  return (
    <label class="grid gap-1 text-sm">
      <span class="font-semibold text-(--color-muted)">{props.label}</span>
      <input
        value={props.value}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        autocomplete={
          props.autocomplete ?? (props.type === "password" ? "new-password" : undefined)
        }
        onInput={(event) => props.onInput(event.currentTarget.value)}
        class={
          props.maskedPlaceholder
            ? `${controlClass} placeholder:text-(--color-text) placeholder:opacity-70`
            : controlClass
        }
      />
      <Show when={props.hint}>
        {(hint) => <span class="text-xs text-(--color-muted)">{hint()}</span>}
      </Show>
    </label>
  );
}
