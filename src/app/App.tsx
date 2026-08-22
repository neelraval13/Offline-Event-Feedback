import { useEffect } from 'react'
import { AppShell } from '../components/AppShell'
import { hrefFor } from '../lib/routing/hashRoute'
import { useHashRoute } from '../lib/routing/useHashRoute'
import { NAV_LINKS, routeFor } from './routes'

function UnknownRoute() {
  return (
    <article className="screen">
      <h1>Screen not found</h1>
      <p className="screen__lede">
        This address does not match a surface of this app.
      </p>
      <p>
        <a href={hrefFor('/')}>Back to start</a>
      </p>
    </article>
  )
}

export function App() {
  const path = useHashRoute()
  const route = routeFor(path)

  useEffect(() => {
    document.title = route ? route.title : 'Screen not found'
  }, [route])

  return (
    /*
     * Chrome and context are per-route, so a capture surface can ask for less
     * of the shell than a console does. Routes that say nothing get the shell's
     * defaults, which is every production screen today.
     */
    <AppShell
      navLinks={NAV_LINKS}
      activePath={path}
      {...(route?.chrome === undefined ? {} : { chrome: route.chrome })}
      {...(route?.context === undefined ? {} : { context: route.context })}
    >
      {route ? route.render() : <UnknownRoute />}
    </AppShell>
  )
}
