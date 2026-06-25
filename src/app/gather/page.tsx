import type { Metadata } from "next";
import GatherData from "@/components/gather/GatherData";
import TopBar from "@/components/layout/TopBar";

export const metadata: Metadata = {
  title: "Gather Data — YourSpotRented",
  description: "Generate Lot Full and Inaccessibility reports.",
};

/**
 * Standalone, network-shareable Gather Data page.
 *
 * Unlike the main dashboard ("/"), this route has NO sidebar — it renders only
 * the Gather Data tool, so people given this link cannot reach the Overbook
 * Checker, Settings, or any other tool. Share `http://<host>:3000/gather`.
 */
export default function GatherSharePage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar title="Gather Data" />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <GatherData />
        </div>
      </main>
    </div>
  );
}
