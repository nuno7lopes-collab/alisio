export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleAlisioDevices: MatrixManagedDeviceInfo[];
  currentAlisioDevices: MatrixManagedDeviceInfo[];
};

const ALISIO_DEVICE_NAME_PREFIX = "Alisio ";

export function isAlisioManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(ALISIO_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const alisioDevices = devices.filter((device) =>
    isAlisioManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleAlisioDevices: alisioDevices.filter((device) => !device.current),
    currentAlisioDevices: alisioDevices.filter((device) => device.current),
  };
}
