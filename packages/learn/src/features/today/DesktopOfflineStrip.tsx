import { Icon } from '@offerpath/ui';

import { AI_OFFLINE_MESSAGE } from '../../components/AiOffline';
import { useDesktopStatus } from '../../lib/plan';

/**
 * The strip at the top of the web app when the desktop is offline (plan
 * 5.3). Says nothing while the status is loading or the desktop is there.
 */
export function DesktopOfflineStrip() {
  const { data } = useDesktopStatus();
  if (!data || data.online) return null;
  return (
    <div className="desktop-offline-strip" role="status">
      <Icon name="cloudOff" size={15} />
      <span>{AI_OFFLINE_MESSAGE}</span>
    </div>
  );
}
