import type {
  ProjectDoctorCheckResult,
  ProjectDoctorRepairResult,
} from '@ecos-studio/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  checkProjectConsistency,
  repairProjectConsistency,
} from '@/utils/projectConsistency'

export interface ProjectConsistencyTarget {
  path: string
  projectType?: string
}

/**
 * Manifest ↔ workspace-directory consistency reports for Project Management.
 *
 * The store only retains backend projects whose doctor check reported
 * findings: consistent projects, frontend projects (no ECC manifest),
 * unavailable runtimes, and older ECC builds without project.doctor.* all
 * stay absent, so the repair panel never shows for them and the read path
 * never writes.
 */
export const useProjectConsistencyStore = defineStore('projectConsistency', () => {
  const reports = ref<Record<string, ProjectDoctorCheckResult>>({})
  let requestSequence = 0

  const inconsistentProjects = computed(() =>
    Object.values(reports.value).filter((report) => report.findings.length > 0),
  )

  async function refresh(projects: readonly ProjectConsistencyTarget[]): Promise<void> {
    const sequence = ++requestSequence
    const backendProjects = projects.filter(
      (project) => project.path && project.projectType !== 'frontend',
    )
    const checked = await Promise.all(
      backendProjects.map(async (project) => {
        try {
          const report = await checkProjectConsistency(project.path)
          return report.status === 'failed' && report.findings.length > 0
            ? ([project.path, report] as const)
            : null
        } catch {
          // Unavailable bridge/runtime or a vanished project directory: no
          // panel, no error noise.
          return null
        }
      }),
    )
    if (sequence !== requestSequence) return
    reports.value = Object.fromEntries(checked.flatMap((entry) => (entry ? [entry] : [])))
  }

  async function repair(projectRoot: string): Promise<ProjectDoctorRepairResult> {
    const result = await repairProjectConsistency(projectRoot)
    // Re-check so the panel reflects the post-repair directory facts.
    try {
      const report = await checkProjectConsistency(projectRoot)
      const next = { ...reports.value }
      if (report.status === 'failed' && report.findings.length > 0) {
        next[projectRoot] = report
      } else {
        delete next[projectRoot]
      }
      reports.value = next
    } catch {
      // A failed re-check keeps the current report; the next project load
      // refresh reconciles it.
    }
    return result
  }

  return { inconsistentProjects, refresh, repair, reports }
})
