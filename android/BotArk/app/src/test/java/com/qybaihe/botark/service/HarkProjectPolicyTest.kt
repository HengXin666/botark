package com.qybaihe.botark.service

import com.qybaihe.botark.model.SyncedHarkProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HarkProjectPolicyTest {
    private fun project(
        id: String,
        activityAt: String,
        kind: String = "project",
        archivedAt: String? = null,
        status: String? = null
    ) = SyncedHarkProject(
        id = id,
        kind = kind,
        title = id,
        archivedAt = archivedAt,
        activityAt = activityAt,
        status = status
    )

    @Test
    fun activeProjectsKeepsOnlyLiveProjectsInRecencyOrder() {
        val projects = listOf(
            project("old", "2026-11-20T10:00:00.000Z"),
            project("main", "2026-11-25T10:00:00.000Z", kind = "main"),
            project("new", "2026-11-24T10:00:00.000Z"),
            project("archived", "2026-11-24T09:00:00.000Z", archivedAt = "2026-11-24T00:00:00.000Z")
        )
        assertEquals(listOf("new", "old"), HarkProjectPolicy.activeProjects(projects).map { it.id })
    }

    @Test
    fun mainAndWorkingShortcutsUseCachedStatusFallback() {
        val projects = listOf(
            project("main", "2026-11-25T10:00:00.000Z", kind = "main"),
            project("p1", "2026-11-24T10:00:00.000Z", status = "working"),
            project("p2", "2026-11-24T09:00:00.000Z", status = "unread"),
            project("p3", "2026-11-24T08:00:00.000Z")
        )
        assertEquals("main", HarkProjectPolicy.mainProject(projects)?.id)
        assertEquals(listOf("p1"), HarkProjectPolicy.workingProjects(projects).map { it.id })
        assertEquals("working", HarkProjectPolicy.statusOf(projects[1], emptyMap()))
        assertEquals("working", HarkProjectPolicy.statusOf(projects[2], mapOf("p2" to "WORKING")))
        assertEquals("", HarkProjectPolicy.statusOf(projects[3], emptyMap()))
    }

    @Test
    fun liveStatusWinsOverStaleCachedStatus() {
        val p1 = project("p1", "2026-11-24T10:00:00.000Z", status = "unread")
        assertEquals("working", HarkProjectPolicy.statusOf(p1, mapOf("p1" to "working")))
        assertEquals(listOf("p1"), HarkProjectPolicy.workingProjects(listOf(p1), mapOf("p1" to "working")).map { it.id })
    }

    @Test
    fun missingMainProjectIsNull() {
        assertNull(HarkProjectPolicy.mainProject(listOf(project("p1", "2026-11-24T10:00:00.000Z"))))
    }

    @Test
    fun autoOpenOnlyWhenExactlyOneProjectIsWorking() {
        val oneWorking = listOf(
            project("p1", "2026-11-24T10:00:00.000Z", status = "working"),
            project("p2", "2026-11-24T09:00:00.000Z", status = "unread")
        )
        assertEquals("p1", HarkProjectPolicy.autoOpenProject(null, true, oneWorking)?.id)
        assertNull(HarkProjectPolicy.autoOpenProject("main", true, oneWorking))
        assertNull(HarkProjectPolicy.autoOpenProject(null, false, oneWorking))
        val twoWorking = oneWorking + project("p3", "2026-11-24T08:00:00.000Z", status = "working")
        assertNull(HarkProjectPolicy.autoOpenProject(null, true, twoWorking))
    }
}
