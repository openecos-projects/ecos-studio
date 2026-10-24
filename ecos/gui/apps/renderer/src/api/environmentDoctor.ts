import type { EnvironmentDoctorResult } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export async function fetchEnvironmentDoctor(): Promise<EnvironmentDoctorResult> {
  return getDesktopApi().app.getEnvironmentDoctor()
}
