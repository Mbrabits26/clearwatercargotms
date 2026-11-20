import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickLaneCheck } from "@/components/bids/QuickLaneCheck";

const { insert } = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert }) } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/market.functions", () => ({ getMarketRates: vi.fn() }));
vi.mock("@/lib/places.functions", () => ({ drivingMiles: vi.fn() }));
vi.mock("@/lib/queries", () => ({ laneHistoryQuery: vi.fn() }));
vi.mock("@/lib/bids", () => ({ historyFor: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/CityInput", () => ({
  CityInput: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) =>
    <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

afterEach(() => { cleanup(); insert.mockClear(); });

describe("Quick lane check quote pricing", () => {
  it.each([0, 0.5])("saves a 5000-dollar round trip with 150-dollar driver assist only once (FSC %s/mi)", async (fuel) => {
    render(<QuickLaneCheck />);
    fireEvent.change(screen.getByPlaceholderText("From — start typing a city"), { target: { value: "Columbus, OH" } });
    fireEvent.change(screen.getByPlaceholderText("To — start typing a city"), { target: { value: "Atlanta, GA" } });
    fireEvent.click(screen.getByLabelText("Round trip (miles there and back)"));
    fireEvent.change(screen.getByPlaceholderText("Miles"), { target: { value: "1140" } });
    fireEvent.change(screen.getByLabelText("Fuel surcharge $/mi"), { target: { value: String(fuel) } });
    const extras = screen.getByPlaceholderText("$").parentElement;
    const select = extras?.querySelector("select");
    const add = extras?.querySelector("button");
    if (!select || !add) throw new Error("Missing extra-charge controls");
    fireEvent.change(select, { target: { value: "Driver Assist" } });
    fireEvent.change(screen.getByPlaceholderText("$"), { target: { value: "150" } });
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("Customer pays us $ (all-in rate)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as a quote" }));
    await waitFor(() => expect(insert).toHaveBeenCalledOnce());
    const saved = insert.mock.calls[0]?.[0] as { rate: number; accessorials: { type: string; amount: number }[] };
    expect(saved.rate).toBe(4850);
    expect(saved.accessorials).toEqual([{ type: "Driver Assist", amount: 150 }]);
    expect(saved.rate + saved.accessorials.reduce((sum, extra) => sum + extra.amount, 0)).toBe(5000);
  });
});