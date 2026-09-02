import { Alert, AlertDescription, AlertTitle } from "@cypheria/ui/components/alert"
import { Badge } from "@cypheria/ui/components/badge"
import { Button } from "@cypheria/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cypheria/ui/components/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@cypheria/ui/components/field"
import { Input } from "@cypheria/ui/components/input"
import { Skeleton } from "@cypheria/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CircleAlert, Copy, ExternalLink, KeyRound, LogOut } from "lucide-react"
import { useEffect, useState } from "react"
import type { CodexLoginRequest, CodexLoginResult } from "../../../ipc/src/index.js"
import { SettingsFrame } from "../components/settings-frame"

export const Route = createFileRoute("/settings/account")({ component: AccountSettingsRoute })

function AccountSettingsRoute() {
  const queryClient = useQueryClient()
  const account = useQuery({
    queryFn: () => window.cypheria?.codex.getAccount(),
    queryKey: ["codex", "account"],
  })
  const [flow, setFlow] = useState<CodexLoginResult | null>(null)
  const login = useMutation({
    mutationFn: async (request: CodexLoginRequest) => {
      if (!window.cypheria) throw new Error("Authentication is only available in the desktop app.")
      return window.cypheria.codex.login(request)
    },
    onSuccess: (result) => {
      setFlow(result)
      if (!result.loginId) void queryClient.invalidateQueries({ queryKey: ["codex", "account"] })
    },
  })
  const logout = useMutation({
    mutationFn: async () => window.cypheria?.codex.logout(),
    onSuccess: async () => {
      setFlow(null)
      await queryClient.invalidateQueries({ queryKey: ["codex"] })
    },
  })

  useEffect(
    () =>
      window.cypheria?.codex.onEvent((envelope) => {
        if (envelope.event !== "codex.notification") return
        const payload = envelope.payload as { method?: string }
        if (payload.method === "account/updated" || payload.method === "account/login/completed") {
          setFlow(null)
          void queryClient.invalidateQueries({ queryKey: ["codex"] })
        }
      }),
    [queryClient]
  )

  if (account.isLoading)
    return (
      <SettingsFrame active="account">
        <Skeleton className="h-80 w-full" />
      </SettingsFrame>
    )

  return (
    <SettingsFrame active="account">
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Account & authentication</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Credentials are handled by the Codex App Server in Cypheria's isolated Codex home.
          </p>
        </div>

        {account.data?.type ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Connected <Badge variant="secondary">{account.data.type}</Badge>
              </CardTitle>
              <CardDescription>
                {account.data.email ?? "Provider credentials are configured."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                {account.data.planType
                  ? `ChatGPT ${account.data.planType}`
                  : "Ready for Codex requests"}
              </span>
              <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Alert>
            <CircleAlert className="size-4" />
            <AlertTitle>No OpenAI account connected</AlertTitle>
            <AlertDescription>
              You can still use Ollama or LM Studio without signing in. OpenAI models require one of
              the methods below.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>ChatGPT</CardTitle>
            <CardDescription>
              Use your ChatGPT subscription through the official browser or device authorization
              flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button disabled={login.isPending} onClick={() => login.mutate({ type: "chatgpt" })}>
              <ExternalLink className="size-4" />
              Continue in browser
            </Button>
            <Button
              variant="outline"
              disabled={login.isPending}
              onClick={() => login.mutate({ type: "chatgptDeviceCode" })}
            >
              Use device code
            </Button>
          </CardContent>
        </Card>

        {flow?.type === "chatgptDeviceCode" ? (
          <DeviceCodeFlow flow={flow} onCanceled={() => setFlow(null)} />
        ) : null}

        <CredentialForm
          title="OpenAI API key"
          description="Stored and used by Codex; Cypheria never sends it to the renderer again."
          fields={[{ key: "apiKey", label: "API key", secret: true }]}
          onSubmit={(values) => login.mutate({ apiKey: values.apiKey ?? "", type: "apiKey" })}
        />
        <CredentialForm
          title="Amazon Bedrock API key"
          description="Connect Bedrock with a bearer API key and AWS region."
          fields={[
            { key: "region", label: "AWS region" },
            { key: "apiKey", label: "API key", secret: true },
          ]}
          onSubmit={(values) =>
            login.mutate({
              apiKey: values.apiKey ?? "",
              region: values.region ?? "",
              type: "amazonBedrock",
            })
          }
        />
        <CredentialForm
          title="Amazon Bedrock access keys"
          description="Use AWS access-key credentials. Session token is optional."
          fields={[
            { key: "region", label: "AWS region" },
            { key: "accessKeyId", label: "Access key ID" },
            { key: "secretAccessKey", label: "Secret access key", secret: true },
            { key: "sessionToken", label: "Session token (optional)", secret: true },
          ]}
          onSubmit={(values) =>
            login.mutate({
              accessKeyId: values.accessKeyId ?? "",
              region: values.region ?? "",
              secretAccessKey: values.secretAccessKey ?? "",
              ...(values.sessionToken ? { sessionToken: values.sessionToken } : {}),
              type: "amazonBedrockAccessKeys",
            })
          }
        />
        {login.error ? <p className="text-sm text-destructive">{login.error.message}</p> : null}
      </div>
    </SettingsFrame>
  )
}

function DeviceCodeFlow({
  flow,
  onCanceled,
}: Readonly<{ flow: CodexLoginResult; onCanceled: () => void }>) {
  const cancel = useMutation({
    mutationFn: async () =>
      flow.loginId ? window.cypheria?.codex.cancelLogin(flow.loginId) : false,
    onSuccess: onCanceled,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authorize this device</CardTitle>
        <CardDescription>Open the verification page and enter this one-time code.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2">
          <code className="rounded-md bg-muted px-4 py-2 text-lg font-semibold tracking-widest">
            {flow.userCode}
          </code>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Copy device code"
            onClick={() => void navigator.clipboard.writeText(flow.userCode ?? "")}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          {flow.verificationUrl ? (
            <Button
              render={
                <a href={flow.verificationUrl} target="_blank" rel="noreferrer">
                  <span className="sr-only">Open verification page</span>
                </a>
              }
              variant="outline"
            >
              <ExternalLink className="size-4" />
              Open verification page
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

type CredentialField = { key: string; label: string; secret?: boolean }

function CredentialForm({
  title,
  description,
  fields,
  onSubmit,
}: Readonly<{
  title: string
  description: string
  fields: CredentialField[]
  onSubmit: (values: Record<string, string>) => void
}>) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(values)
          }}
        >
          <FieldGroup>
            {fields.map((field) => (
              <Field key={field.key}>
                <FieldLabel htmlFor={`${title}-${field.key}`}>{field.label}</FieldLabel>
                <Input
                  id={`${title}-${field.key}`}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  value={values[field.key] ?? ""}
                  required={!field.label.includes("optional")}
                  onChange={(event) =>
                    setValues({ ...values, [field.key]: event.currentTarget.value })
                  }
                />
                {field.key === "region" ? (
                  <FieldDescription>For example: us-east-1</FieldDescription>
                ) : null}
              </Field>
            ))}
          </FieldGroup>
          <Button className="justify-self-end" type="submit" variant="outline">
            Connect
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
