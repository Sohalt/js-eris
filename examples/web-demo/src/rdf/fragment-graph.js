function FragmentGraph (baseSubject) {
  if (baseSubject.termType !== 'NamedNode') {
    throw new Error('base subject is note a NamedNode')
  }

  // parse subject value as URL
  const urlBaseSubject = new URL(baseSubject.value)

  // ensure that base Subject is not a fragment url
  if (urlBaseSubject.hash.length === 0) {
    this.baseSubject = baseSubject
    this.fragments = new Map()
    this.statements = new Map()
  } else {
    throw new Error('base subject has a fragment part')
  }
}


function getFragment (base, s) {
  const parts = s.split('#')
  if (base === parts[0]) {
    return parts[1] || ''
  } else {
    return -1
  }
}

function containsBlankNode (quad) {
  return (quad.subject.termType === 'BlankNode' ||
     quad.predicate.termType === 'BlankNode' ||
     quad.object.termType === 'BlankNode')
}

function addToIndex (index, p, o) {
  if (index.has(p)) {
    index.get(p).add(o)
  } else {
    index.set(p, new Set([o]))
  }
}

FragmentGraph.prototype._addStatement = function (p, o) {
  addToIndex(this.statements, p ,o)
}

FragmentGraph.prototype._addFragmentStatement = function (f, p, o) {
  if (this.fragments.has(f)) {
    addToIndex(this.fragments.get(f), p, o)
  } else {
    this.fragments.set(f, new Map())
    addToIndex(this.fragments.get(f), p, o)
  }
}

// A special term type
function FragmentReference (value) {
  this.termType = 'FragmentReference'
  this.value = value
}

FragmentGraph.prototype._toFragmentReference = function (t) {
  if (t.termType === 'NamedNode') {
    const f = getFragment(this.baseSubject.value, t.value)
    if (f === -1) {
      return t
    } else {
      return new FragmentReference(f)
    }
  }

  return t
}

FragmentGraph.prototype.addQuad = function (quad) {
  // TODO implement Skolemization
  if (containsBlankNode(quad)) return

  const f = getFragment(this.baseSubject.value, quad.subject.value)

  if (f === '') {
    this._addStatement(
      this._toFragmentReference(quad.predicate),
      this._toFragmentReference(quad.object))
  } else if (f === -1) {
  } else {
    this._addFragmentStatement(
      f,
      this._toFragmentReference(quad.predicate),
      this._toFragmentReference(quad.object))
  }
}


function encodeTerm (t) {
  switch (t.termType) {

    case 'NamedNode':
      return t.value.length.toString().concat(':', t.value)

    case 'Literal':
      if (t.datatype.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString') {
        return '('.concat('1:l',
                     t.value.length.toString().concat(':', t.value),
                     t.datatype.value.length.toString().concat(':', t.datatype.value),
                     t.language.length.toString().concat(':', t.language),
                     ')')
      } else {
        return '('.concat('1:l',
                     t.value.length.toString().concat(':', t.value),
                     t.datatype.value.length.toString().concat(':', t.datatype.value),
                     ')')
      }

    case 'FragmentReference':
      return '('.concat('1:f', t.value.length.toString().concat(':', t.value))

    default:
      throw new Error('unexpexted term type')
  }
}

FragmentGraph.prototype.toCanonicalForm = function () {

  // collect an array of encoded statements (and fragment statements)
  const statements = []

  // encode s forms
  for (const st of this.statements) {
    const p = st[0]
    for (const o of st[1]) {
      statements.push('('.concat('1:s', encodeTerm(p), encodeTerm(o), ')'))
    }
  }

  // encode fs forms
  for (const fst of this.fragments) {
    const f = fst[0]
    for (const st of fst[1]) {
      const p = st[0]
      for (const o of st[1]) {
        statements.push('('.concat('2:fs',
                                   f.length.toString().concat(':',f),
                                   encodeTerm(p),
                                   encodeTerm(o),
                                   ')'))
      }
    }
  }

  const csexp = '(3:rdf'.concat(
    statements.sort().join(''),
    ')')

  const encoder = new TextEncoder()
  return encoder.encode(csexp)
}

module.exports = FragmentGraph
