import { createContext, useContext } from 'react'
import type { OctaveEngineStatus } from './App'

export interface OctaveContextValue {
  engineStatus: OctaveEngineStatus
}

export const OctaveContext = createContext<OctaveContextValue>({
  engineStatus: 'disconnected',
})

export function useOctaveStatus(): OctaveEngineStatus {
  return useContext(OctaveContext).engineStatus
}
