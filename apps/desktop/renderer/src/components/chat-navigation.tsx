import { Link } from "@tanstack/react-router"
import { atom, useSetAtom } from "jotai"
import type { ComponentProps } from "react"

export const newChatRevisionAtom = atom(0)

// A new draft must also reset when the current URL is already "/".
export function NewChatLink({ onClick, ...props }: Omit<ComponentProps<"a">, "href">) {
  const setRevision = useSetAtom(newChatRevisionAtom)
  return (
    <Link
      {...props}
      to="/"
      search={{}}
      onClick={(event) => {
        onClick?.(event)
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          (!event.currentTarget.target || event.currentTarget.target === "_self")
        ) {
          setRevision((revision) => revision + 1)
        }
      }}
    />
  )
}
