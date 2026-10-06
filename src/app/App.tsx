import { useEffect, useState } from 'react'

import { StudioView } from '@/features/studio/components/StudioView'
import { useStudioController } from '@/features/studio/useStudioController'
import { DotMaterialLab } from '@/features/rendering/components/DotMaterialLab'
import { StudioLanguageProvider } from '@/i18n'

const DOT_LAB_HASH = '#dot-lab'

function StudioApp() {
  const controller = useStudioController()
  return <StudioView {...controller} />
}

/**
 * The tuning harness lives behind a hash rather than a router.
 *
 * The studio has no routing and adding one for a single internal page would be
 * a dependency and a navigation model to maintain for something an author
 * visits while tuning. A hash needs neither and survives a reload.
 */
function useIsDotLab(): boolean {
  const [isDotLab, setIsDotLab] = useState(
    () => typeof window !== 'undefined' && window.location.hash === DOT_LAB_HASH
  )
  useEffect(() => {
    const update = () => setIsDotLab(window.location.hash === DOT_LAB_HASH)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return isDotLab
}

export default function App() {
  const isDotLab = useIsDotLab()
  return (
    <StudioLanguageProvider>{isDotLab ? <DotMaterialLab /> : <StudioApp />}</StudioLanguageProvider>
  )
}
