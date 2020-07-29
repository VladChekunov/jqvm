import $ from 'jquery'
import Store from 'tyshemo/src/store'
import ScopeX from 'scopex'
import { getStringHash, isNone, each, isInstanceOf, isObject, isFunction } from 'ts-fns'

import { getOuterHTML, parseAttrs, tryParseJSON } from './utils.js'

const components = {}
const directives = {}

function component(name, link) {
  components[name] = link
}

function directive(attr, link) {
  directives[attr] = link
}

function compileDirectives($wrapper, scopex) {
  const attrs = Object.keys(directives)
  attrs.forEach((attr) => {
    const link = directives[attr]
    const els = $wrapper.find(`[${attr}]`)

    els.each(function() {
      const $el = $(this)

      const oAttrs = Array.from(this.attributes)
      const attrs = {}
      oAttrs.forEach((node) => {
        const { name, value } = node
        attrs[name] = value
      })

      const output = link.call(scopex, $el, attrs)
      if (!isNone(output) && $el !== output) {
        $el.replaceWith(output)
      }
    })
  })
}

function compileComponents($wrapper, scopex) {
  const names = Object.keys(components)
  names.forEach((name) => {
    const link = components[name]
    const els = $wrapper.find(name)

    els.each(function() {
      const $el = $(this)
      const outerHTML = this.outerHTML

      const html = outerHTML.replace(new RegExp(`<${name}([\\s\\S]*?)>[\\s\\S]*?</${name}>`, 'gm'), (component, attrsStr) => {
        const attrsArr = parseAttrs(attrsStr)
        const attrs = {}
        attrsArr.forEach(({ key, value}) => {
          attrs[key] = value
        })
        const output = link.call(scopex, $el, attrs)
        return output
      })
      const result = compile(html, scopex)
      $el.replaceWith(result)
    })
  })
}

function compile(template, scopex) {
  const $wrapper = $('<div />').html(template)
  compileDirectives($wrapper, scopex)
  compileComponents($wrapper, scopex)
  const innerHTML = $wrapper.html()
  const result = scopex.interpolate(innerHTML)
  return result
}

function vm(initState) {
  const $this = $(this)
  const el = $this[0]
  const hash = getStringHash(getOuterHTML(el))
  const container = `[jq-vm=${hash}]`
  const template = $this.html()
  const getMountNode = () => {
    return mountTo ? $(mountTo) : $this.next(container)
  }

  let store = null
  let scope = null
  let scopex = null

  let mountTo = null
  let isMounted = false

  const callbacks = []
  const view = new View()

  function init() {
    if (isFunction(initState)) {
      initState = initState()
    }

    if (isInstanceOf(initState, Store)) {
      store = initState
      scope = store.state
      scopex = new ScopeX(scope)
    }
    else if (isObject(initState)) {
      store = new Store(initState)
      scope = store.state
      scopex = new ScopeX(scope)
    }
    else {
      store = initState
      scope = initState
      scopex = new ScopeX(scope)
    }

    $this.on('$mount', () => {
      const $container = getMountNode()
      callbacks.forEach((item) => {
        const { action, info, callback } = item
        $container[action](...info, callback)
      })
    })

    $this.on('$unmount', () => {
      const $container = getMountNode()
      callbacks.forEach((item, i) => {
        const { info, callback } = item
        $container.off(...info, callback)
        callbacks.splice(i, 1)
      })
    })
  }

  function destroy() {
    store = null
    scope = null
    scopex = null
  }

  function render() {
    const $container = getMountNode()
    const $retainers = $container.find('[jq-hash]')

    const active = document.activeElement
    const activeStart = active.selectionStart
    const activeEnd = active.selectionEnd
    const activeTag = active.tagName.toLocaleLowerCase()
    const activeType = active.type

    const result = compile(template, scopex)
    $container.html(result)

    $retainers.each(function() {
      const $retainer = $(this)
      const $container = $(container)
      const hash = $retainer.attr('jq-hash')

      const $target = $container.find(`[jq-hash=${hash}]`)
      if ($target.length) {
        $target.replaceWith($retainer)
      }
    })

    const $active = $(active)
    const hash = $active.attr('jq-hash')
    if (hash && (activeTag === 'input' || activeTag === 'textarea')) {
      if (activeTag === 'input' && ['checkbox', 'radio', 'range', 'color'].includes(activeType)) {
        return
      }

      const $target = $(`[jq-hash=${hash}]`)

      if (!$target.length) {
        return
      }

      const target = $target[0]
      target.focus()
      target.setSelectionRange(activeStart, activeEnd)
    }
  }

  function mount(el) {
    if (isMounted) {
      return view
    }

    if ($this.next(container).length) {
      return view
    }

    init()

    let $container = null

    mountTo = el || null // cache mount node
    isMounted = true

    if (el) {
      $container = $(el)
      $container.attr('jq-vm', hash)
    }
    else {
      $container = $('<div />', {
        'jq-vm': hash,
      })
      $this.after($container)
    }

    render()

    if (typeof store.watch === 'function') {
      store.watch('*', render, true)
    }

    $this.trigger('$mount')
    $container.trigger('$mount')

    return view
  }

  function unmount() {
    if (!isMounted) {
      return view
    }

    const $container = getMountNode()

    if (!$container.length) {
      return
    }

    $container.trigger('$unmount')
    $this.trigger('$unmount')

    if (typeof store.unwatch === 'function') {
      store.unwatch('*', render)
    }

    if (mountTo) {
      $container.html('')
      $container.removeAttr('jq-vm')
    }
    else {
      $container.remove()
    }

    callbacks.length = 0
    mountTo = null
    isMounted = false

    destroy()

    return view
  }

  function update() {
    if (!isMounted) {
      return view
    }

    render()

    const $container = getMountNode()
    $container.trigger('$update')

    return view
  }

  function bind(args, once) {
    const info = [...args]
    const fn = info.pop()
    const callback = function(e) {
      const handle = fn.call(view, scope)
      return isFunction(handle) ? handle.call(this, e) : null
    }
    const action = once ? 'one' : 'on'

    callbacks.push({ action, info, fn, callback })
  }

  function unbind(args) {
    if (args.length === 1) {
      const $container = getMountNode()
      $container.off(...args)
      return
    }

    const info = [...args]
    const fn = info.pop()
    const $container = getMountNode()

    callbacks.forEach((item, i) => {
      const { info, callback } = item
      if (fn !== item.fn) {
        return
      }

      $container.off(...info, callback)
      callbacks.splice(i, 1)
    })
  }

  function find(selector) {
    const $container = getMountNode()
    return $container.find(selector)
  }

  Object.assign(view, {
    once(...args) {
      bind(args, true)
      return view
    },
    on(...args) {
      bind(args)
      return view
    },
    off(...args) {
      unbind(...args)
      return view
    },
    mount,
    unmount,
    update,
    find,
  })
  return view
}

// register inside directives

directive('jq-id', function(el, attrs) {
  const attr = attrs['jq-id']
  const value = this.interpolate(attr)
  attrs['jq-id'] = value
})

directive('jq-if', function(el, attrs) {
  const attr = attrs['jq-if']
  const value = tryParseJSON(attr, (attr) => this.parse(attr))
  return value ? el : ''
})

directive('jq-class', function(el, attrs) {
  const attr = attrs['jq-class']
  const obj = this.parse(attr)
  each(obj, (value ,key) => {
    if (value) {
      el.addClass(key)
    }
  })
})

directive('jq-value', function(el, attrs) {
  const hash = attrs['jq-hash'] || getStringHash(getOuterHTML(el[0]))

  const attr = attrs['jq-value']
  const value = this.parse(attr)

  if (el.is('select')) {
    const option = el.find(`option[value=${value}]`)
    option.attr('selected', 'selected')
  }
  else if (el.is('input')) {
    el.attr('value', value)
  }
  else if (el.is('textarea')) {
    el.text(value)
  }

  el.attr('jq-hash', hash)
})

directive('jq-disabled', function(el, attrs) {
  const hash = attrs['jq-hash'] || getStringHash(getOuterHTML(el[0]))

  const attr = attrs['jq-disabled']
  const value = this.parse(attr)

  el.attr('disabled', value ? 'disabled' : null)
  el.attr('jq-hash', hash)
})

directive('jq-checked', function(el, attrs) {
  const hash = attrs['jq-hash'] || getStringHash(getOuterHTML(el[0]))

  const attr = attrs['jq-checked']
  const value = this.parse(attr)

  el.attr('checked', value ? 'checked' : null)
  el.attr('jq-hash', hash)
})

directive('jq-selected', function(el, attrs) {
  const hash = attrs['jq-hash'] || getStringHash(getOuterHTML(el[0]))

  const attr = attrs['jq-selected']
  const value = this.parse(attr)

  el.attr('selected', value ? 'selected' : null)
  el.attr('jq-hash', hash)
})

directive('jq-src', function(el, attrs) {
  const hash = attrs['jq-hash'] || getStringHash(getOuterHTML(el[0]))

  const attr = attrs['jq-src']
  const value = this.parse(attr)

  el.attr('jq-hash', hash)
  el.attr('src', value)
})

directive('jq-repeat', function(el, attrs) {
  const attr = attrs['jq-repeat']
  const repeatScope = attrs['repeat-scope'] || '{}'
  const repeatKey = attrs['repeat-key'] || 'key'
  const repeatValue = attrs['repeat-value'] || 'value'

  const data = this.parse(attr)
  const scope = this.parse(repeatScope)

  // make it not be able to compile again
  el.removeAttr('jq-repeat')
  el.attr('x-jq-repeat', attr)

  const template = el[0].outerHTML
  const els = []

  each(data, (value, key) => {
    const scopex = new ScopeX({
      [repeatKey]: key,
      [repeatValue]: value,
      ...scope,
    })

    const html = compile(template, scopex)
    const result = scopex.interpolate(html)
    els.push(result)
  })

  const result = els.join('')
  const output = result.replace(/x\-jq\-repeat/g, 'jq-repeat')
  el.replaceWith(output)
})

// --------------------------------

class View {}

$.fn.vm = vm
$.vm = {
  component,
  directive,
  Store,
  View,
}

export { vm, Store, component, directive, View }
export default vm
