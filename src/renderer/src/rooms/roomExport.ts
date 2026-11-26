import { roomMarkdown, type CollabRoom } from './model'

export const NEW_ROOM_ID = 'room-create'

export function exportRoomMarkdownFile(room: CollabRoom, finalId?: string) {
  const url = URL.createObjectURL(new Blob([roomMarkdown(room, finalId)], { type: 'text/markdown' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${room.title}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
