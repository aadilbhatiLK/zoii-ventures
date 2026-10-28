import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/login",
  useParams: () => ({}),
}));

import { AuthProvider, Can, useAuth } from "@/features/auth/auth-provider";
import { LoginForm } from "@/features/auth/login-form";
import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/states";
import { TooltipProvider } from "@/components/ui/menu";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("LoginForm", () => {
  it("shows a validation message without calling the API", async () => {
    wrap(<LoginForm />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your email and password.");
  });

  it("signs in a demo user and redirects to the dashboard", async () => {
    wrap(<LoginForm />);
    await userEvent.type(await screen.findByLabelText("Work email"), "neha@demo.zoii.in");
    await userEvent.type(screen.getByLabelText("Password"), "zoii-demo");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"), { timeout: 3000 });
  });

  it("asks privileged users for a second factor", async () => {
    wrap(<LoginForm />);
    await userEvent.type(await screen.findByLabelText("Work email"), "finance@demo.zoii.in");
    await userEvent.type(screen.getByLabelText("Password"), "zoii-demo");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "Two-step verification" }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe("Can (permission-dependent UI)", () => {
  function Probe() {
    const { switchPersona, user } = useAuth();
    return (
      <div>
        <button onClick={() => void switchPersona?.("u_sales1")}>as-exec</button>
        <button onClick={() => void switchPersona?.("u_founder")}>as-founder</button>
        <span data-testid="who">{user?.id ?? "none"}</span>
        <Can permission="leads.assign" fallback={<span>no-assign</span>}>
          <span>can-assign</span>
        </Can>
      </div>
    );
  }
  it("hides actions the role lacks and shows them when it has them", async () => {
    wrap(<Probe />);
    await userEvent.click(await screen.findByText("as-exec"));
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("u_sales1"));
    expect(screen.getByText("no-assign")).toBeInTheDocument();
    await userEvent.click(screen.getByText("as-founder"));
    await waitFor(() => expect(screen.getByText("can-assign")).toBeInTheDocument());
  });
});

describe("DataTable", () => {
  it("renders the empty state and pagination summary", () => {
    wrap(
      <DataTable<{ id: string }>
        label="Things"
        columns={[{ id: "id", header: "ID", cell: ({ row }) => row.original.id }]}
        data={[]}
        total={0}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        sorting={[]}
        onSortingChange={() => {}}
        getRowId={(r) => r.id}
        empty={<EmptyState title="Nothing here" />}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("shows an error state with retry", async () => {
    const retry = vi.fn();
    wrap(
      <DataTable<{ id: string }>
        label="Things"
        columns={[{ id: "id", header: "ID" }]}
        data={[]}
        total={0}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        sorting={[]}
        onSortingChange={() => {}}
        getRowId={(r) => r.id}
        error="Can't reach the server."
        onRetry={retry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("LoginForm errors", () => {
  it("shows the credential error, not a session-expired message", async () => {
    wrap(<LoginForm />);
    await userEvent.type(await screen.findByLabelText("Work email"), "neha@demo.zoii.in");
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "Email or password is incorrect.",
    );
  });
});
