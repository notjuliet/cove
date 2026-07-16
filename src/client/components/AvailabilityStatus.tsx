import type { RequestAvailability } from "../../shared/types";

export function AvailabilityStatus(props: { availability: RequestAvailability }) {
  return (
    <span
      class={`text-xs font-medium capitalize ${
        props.availability === "available" ? "text-(--color-accent)" : "text-(--color-muted)"
      }`}
    >
      {props.availability}
    </span>
  );
}
