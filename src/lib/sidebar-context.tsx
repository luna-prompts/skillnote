'use client'
import { createContext, useContext } from 'react'

type SidebarContextType = {
  open: boolean
  setOpen: (v: boolean) => void
}

export const SidebarContext = createContext<SidebarContextType>({
  open: false,
  setOpen: () => {},
})

export const useSidebar = () => useContext(SidebarContext)
