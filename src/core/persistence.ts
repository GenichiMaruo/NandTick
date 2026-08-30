import type { Project } from './model'

const DATABASE = 'nandtick-projects'
const STORE = 'projects'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveProject(project: Project): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(project)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const database = await openDatabase()
  const project = await new Promise<Project | undefined>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result as Project | undefined)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return project
}

export async function listProjects(): Promise<Array<Pick<Project, 'id' | 'name' | 'updatedAt'>>> {
  const database = await openDatabase()
  const projects = await new Promise<Project[]>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result as Project[])
    request.onerror = () => reject(request.error)
  })
  database.close()
  return projects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export function importProject(text: string): Project {
  const project = JSON.parse(text) as Project
  if (project.version !== 1 || !project.id || !project.mainGraph || !Array.isArray(project.definitions)) throw new Error('This is not a supported NandTick project file')
  return project
}
