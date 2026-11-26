package com.qybaihe.botark.service

import com.qybaihe.botark.model.SyncedHarkProject
import java.time.Instant

/**
 * Shared multi-project ordering/status rules for the native Hark fallback.
 * Mirrors the Linux renderer's shared/harkProjects.ts helpers so project
 * recency, the working shortcut and cached-status fallback stay identical.
 */
object HarkProjectPolicy {
    fun mainProject(projects: List<SyncedHarkProject>): SyncedHarkProject? =
        projects.firstOrNull { it.kind == "main" }

    fun activeProjects(projects: List<SyncedHarkProject>): List<SyncedHarkProject> =
        projects
            .filter { it.kind != "main" && it.archivedAt == null }
            .sortedByDescending { runCatching { Instant.parse(it.activityAt) }.getOrNull() ?: Instant.EPOCH }

    fun statusOf(project: SyncedHarkProject, statuses: Map<String, String>): String =
        (statuses[project.id]?.takeIf { it.isNotBlank() } ?: project.status.orEmpty()).lowercase()

    fun workingProjects(
        projects: List<SyncedHarkProject>,
        statuses: Map<String, String> = emptyMap()
    ): List<SyncedHarkProject> =
        activeProjects(projects).filter { statusOf(it, statuses) == "working" }

    /**
     * Linux resume rule: only auto-open when the user opted in, no session is
     * already active, and exactly one project is working. Several working
     * projects stay on the project list so the user can choose.
     */
    fun autoOpenProject(
        activeSessionId: String?,
        resumeLast: Boolean,
        projects: List<SyncedHarkProject>,
        statuses: Map<String, String> = emptyMap()
    ): SyncedHarkProject? {
        if (!resumeLast || !activeSessionId.isNullOrBlank()) return null
        return workingProjects(projects, statuses).singleOrNull()
    }
}
