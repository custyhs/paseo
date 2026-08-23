import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { DraftsScreen } from "@/screens/drafts-screen";

export default function DraftsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <DraftsScreen />
    </HostRouteBootstrapBoundary>
  );
}
