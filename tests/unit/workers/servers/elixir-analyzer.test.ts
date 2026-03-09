import { describe, it, expect } from 'vitest';
import {
  analyzeElixirSource,
  getHoverInfoAt,
  findDefinitionAt,
  getSignatureHelpAt,
} from '../../../../src/workers/servers/elixir-analyzer';

// ─── Module Parsing ──────────────────────────────────────────────────────────

describe('analyzeElixirSource', () => {
  describe('module parsing', () => {
    it('parses a simple module', () => {
      const source = `defmodule MyApp do
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules).toHaveLength(1);
      expect(analysis.modules[0]!.name).toBe('MyApp');
      expect(analysis.modules[0]!.range.startLine).toBe(0);
      expect(analysis.modules[0]!.range.endLine).toBe(1);
    });

    it('parses a nested module name', () => {
      const source = `defmodule MyApp.Accounts.User do
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules).toHaveLength(1);
      expect(analysis.modules[0]!.name).toBe('MyApp.Accounts.User');
    });

    it('parses module with @moduledoc heredoc', () => {
      const source = `defmodule MyApp do
  @moduledoc """
  This is the main application module.
  It does many things.
  """
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.doc).toBe(
        '  This is the main application module.\n  It does many things.',
      );
    });

    it('parses module with @moduledoc single-line string', () => {
      const source = `defmodule MyApp do
  @moduledoc "A simple module"
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.doc).toBe('A simple module');
    });

    it('handles @moduledoc false', () => {
      const source = `defmodule MyApp.Internal do
  @moduledoc false
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.doc).toBeNull();
    });

    it('parses nested modules', () => {
      const source = `defmodule Outer do
  defmodule Inner do
  end
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules).toHaveLength(2);
      expect(analysis.modules[0]!.name).toBe('Outer');
      expect(analysis.modules[1]!.name).toBe('Inner');
    });
  });

  // ─── Function Parsing ────────────────────────────────────────────────────

  describe('function parsing', () => {
    it('parses a public function with params', () => {
      const source = `defmodule MyApp do
  def greet(name, greeting) do
    "\#{greeting}, \#{name}!"
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.name).toBe('greet');
      expect(func.arity).toBe(2);
      expect(func.params).toEqual(['name', 'greeting']);
      expect(func.visibility).toBe('public');
      expect(func.kind).toBe('def');
    });

    it('parses a private function', () => {
      const source = `defmodule MyApp do
  defp helper(x) do
    x + 1
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.name).toBe('helper');
      expect(func.visibility).toBe('private');
      expect(func.kind).toBe('defp');
    });

    it('parses a function with @spec', () => {
      const source = `defmodule MyApp do
  @spec greet(String.t()) :: String.t()
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.name).toBe('greet');
      expect(func.spec).toBe('greet(String.t()) :: String.t()');
    });

    it('parses a function with @doc', () => {
      const source = `defmodule MyApp do
  @doc "Greets someone"
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.doc).toBe('Greets someone');
    });

    it('parses a function with @doc heredoc', () => {
      const source = `defmodule MyApp do
  @doc """
  Greets the given person.

  ## Examples

      iex> greet("World")
      "Hello, World!"
  """
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.doc).toContain('Greets the given person.');
    });

    it('parses a function with guard clause', () => {
      const source = `defmodule MyApp do
  def check(x) when is_integer(x) do
    :ok
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.guardClause).toBe('is_integer(x)');
    });

    it('parses defmacro', () => {
      const source = `defmodule MyApp do
  defmacro my_macro(expr) do
    quote do
      unquote(expr)
    end
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.kind).toBe('defmacro');
      expect(func.visibility).toBe('public');
    });

    it('parses defmacrop as private', () => {
      const source = `defmodule MyApp do
  defmacrop internal_macro(x) do
    x
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.kind).toBe('defmacrop');
      expect(func.visibility).toBe('private');
    });

    it('parses function with no params', () => {
      const source = `defmodule MyApp do
  def hello do
    "hello"
  end
end`;
      const analysis = analyzeElixirSource(source);
      const func = analysis.modules[0]!.functions[0]!;
      expect(func.name).toBe('hello');
      expect(func.arity).toBe(0);
      expect(func.params).toEqual([]);
    });

    it('parses multiple functions in same module', () => {
      const source = `defmodule MyApp do
  def foo(a) do
    a
  end

  def bar(b, c) do
    b + c
  end
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.functions).toHaveLength(2);
      expect(analysis.modules[0]!.functions[0]!.name).toBe('foo');
      expect(analysis.modules[0]!.functions[1]!.name).toBe('bar');
    });

    it('parses function with bang suffix', () => {
      const source = `defmodule MyApp do
  def fetch!(id) do
    :ok
  end
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.functions[0]!.name).toBe('fetch!');
    });

    it('parses function with question mark suffix', () => {
      const source = `defmodule MyApp do
  def valid?(input) do
    true
  end
end`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules[0]!.functions[0]!.name).toBe('valid?');
    });
  });

  // ─── Type Parsing ────────────────────────────────────────────────────────

  describe('type parsing', () => {
    it('parses @type definition', () => {
      const source = `defmodule MyApp do
  @type name :: String.t()
end`;
      const analysis = analyzeElixirSource(source);
      const type = analysis.modules[0]!.types[0]!;
      expect(type.name).toBe('name');
      expect(type.definition).toBe('@type name :: String.t()');
      expect(type.visibility).toBe('public');
    });

    it('parses @typep definition', () => {
      const source = `defmodule MyApp do
  @typep internal_state :: map()
end`;
      const analysis = analyzeElixirSource(source);
      const type = analysis.modules[0]!.types[0]!;
      expect(type.name).toBe('internal_state');
      expect(type.visibility).toBe('private');
    });

    it('parses @opaque definition', () => {
      const source = `defmodule MyApp do
  @opaque token :: binary()
end`;
      const analysis = analyzeElixirSource(source);
      const type = analysis.modules[0]!.types[0]!;
      expect(type.name).toBe('token');
      expect(type.visibility).toBe('opaque');
    });

    it('parses type with @typedoc', () => {
      const source = `defmodule MyApp do
  @typedoc "A user's name"
  @type name :: String.t()
end`;
      const analysis = analyzeElixirSource(source);
      const type = analysis.modules[0]!.types[0]!;
      expect(type.doc).toBe("A user's name");
    });
  });

  // ─── Callback Parsing ────────────────────────────────────────────────────

  describe('callback parsing', () => {
    it('parses @callback', () => {
      const source = `defmodule MyApp.Behaviour do
  @callback init(opts :: keyword()) :: {:ok, state :: term()} | {:error, reason :: term()}
end`;
      const analysis = analyzeElixirSource(source);
      const callback = analysis.modules[0]!.callbacks[0]!;
      expect(callback.name).toBe('init');
    });
  });

  // ─── Directive Parsing ───────────────────────────────────────────────────

  describe('directive parsing', () => {
    it('parses alias directive', () => {
      const source = `defmodule MyApp do
  alias MyApp.Accounts.User
end`;
      const analysis = analyzeElixirSource(source);
      const directive = analysis.modules[0]!.directives[0]!;
      expect(directive.kind).toBe('alias');
      expect(directive.module).toBe('MyApp.Accounts.User');
    });

    it('parses import directive', () => {
      const source = `defmodule MyApp do
  import Ecto.Query
end`;
      const analysis = analyzeElixirSource(source);
      const directive = analysis.modules[0]!.directives[0]!;
      expect(directive.kind).toBe('import');
      expect(directive.module).toBe('Ecto.Query');
    });

    it('parses use directive', () => {
      const source = `defmodule MyApp do
  use GenServer
end`;
      const analysis = analyzeElixirSource(source);
      const directive = analysis.modules[0]!.directives[0]!;
      expect(directive.kind).toBe('use');
      expect(directive.module).toBe('GenServer');
    });

    it('parses require directive', () => {
      const source = `defmodule MyApp do
  require Logger
end`;
      const analysis = analyzeElixirSource(source);
      const directive = analysis.modules[0]!.directives[0]!;
      expect(directive.kind).toBe('require');
      expect(directive.module).toBe('Logger');
    });

    it('parses top-level directives outside modules', () => {
      const source = `import Kernel
alias Some.Module`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.topLevelDirectives).toHaveLength(2);
      expect(analysis.topLevelDirectives[0]!.kind).toBe('import');
      expect(analysis.topLevelDirectives[1]!.kind).toBe('alias');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty file', () => {
      const analysis = analyzeElixirSource('');
      expect(analysis.modules).toHaveLength(0);
      expect(analysis.topLevelDirectives).toHaveLength(0);
    });

    it('handles file with only comments', () => {
      const source = `# This is a comment
# Another comment`;
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules).toHaveLength(0);
    });

    it('handles partial/broken code gracefully', () => {
      const source = `defmodule MyApp do
  def incomplete(`;
      // Should not throw
      const analysis = analyzeElixirSource(source);
      expect(analysis.modules).toHaveLength(1);
    });
  });
});

// ─── Hover Info ──────────────────────────────────────────────────────────────

describe('getHoverInfoAt', () => {
  it('returns hover info for a function name', () => {
    const source = `defmodule MyApp do
  @spec greet(String.t()) :: String.t()
  def greet(name) do
    "Hello, \#{name}!"
  end
end`;
    const analysis = analyzeElixirSource(source);
    const hover = getHoverInfoAt(analysis, source, 2, 6);
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('greet');
    expect(hover!.contents.value).toContain('@spec');
    expect(hover!.contents.kind).toBe('markdown');
  });

  it('returns hover info for a module name', () => {
    const source = `defmodule MyApp.Users do
  @moduledoc "User management"
end`;
    const analysis = analyzeElixirSource(source);
    // Hover on the module name in the defmodule line
    const hover = getHoverInfoAt(analysis, source, 0, 12);
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('MyApp.Users');
    expect(hover!.contents.value).toContain('User management');
  });

  it('returns hover info for a function with doc', () => {
    const source = `defmodule MyApp do
  @doc "Says hello"
  def hello do
    "hello"
  end
end`;
    const analysis = analyzeElixirSource(source);
    const hover = getHoverInfoAt(analysis, source, 2, 6);
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('Says hello');
  });

  it('returns null for empty line', () => {
    const source = `defmodule MyApp do

end`;
    const analysis = analyzeElixirSource(source);
    const hover = getHoverInfoAt(analysis, source, 1, 0);
    expect(hover).toBeNull();
  });

  it('returns null for whitespace', () => {
    const source = `defmodule MyApp do
  def foo do
    :ok
  end
end`;
    const analysis = analyzeElixirSource(source);
    const hover = getHoverInfoAt(analysis, source, 0, 0);
    // 'defmodule' is not a module or function name
    expect(hover).toBeNull();
  });

  it('returns hover info for a type', () => {
    const source = `defmodule MyApp do
  @typedoc "A name type"
  @type name :: String.t()
end`;
    const analysis = analyzeElixirSource(source);
    const hover = getHoverInfoAt(analysis, source, 2, 9);
    expect(hover).not.toBeNull();
    expect(hover!.contents.value).toContain('@type name');
    expect(hover!.contents.value).toContain('A name type');
  });
});

// ─── Definition Finding ─────────────────────────────────────────────────────

describe('findDefinitionAt', () => {
  it('finds function definition in the same file', () => {
    const source = `defmodule MyApp do
  def greet(name) do
    helper(name)
  end

  defp helper(name) do
    "Hello, \#{name}!"
  end
end`;
    const analysis = analyzeElixirSource(source);
    const analyses = new Map([['file:///test.ex', analysis]]);

    // Cursor on "helper" call at line 2
    const defs = findDefinitionAt(analyses, 'file:///test.ex', source, 2, 4);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]!.range.start.line).toBe(5);
  });

  it('finds module definition across files', () => {
    const source1 = `defmodule MyApp.Accounts do
  def list_users do
    []
  end
end`;
    const source2 = `defmodule MyApp.Web do
  alias MyApp.Accounts
  def index do
    MyApp.Accounts.list_users()
  end
end`;
    const analysis1 = analyzeElixirSource(source1);
    const analysis2 = analyzeElixirSource(source2);
    const analyses = new Map([
      ['file:///accounts.ex', analysis1],
      ['file:///web.ex', analysis2],
    ]);

    // Cursor on "MyApp.Accounts" in source2 line 3
    const defs = findDefinitionAt(analyses, 'file:///web.ex', source2, 3, 8);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]!.uri).toBe('file:///accounts.ex');
  });

  it('returns empty array when no definition found', () => {
    const source = `defmodule MyApp do
  def test do
    unknown_func()
  end
end`;
    const analysis = analyzeElixirSource(source);
    const analyses = new Map([['file:///test.ex', analysis]]);

    const defs = findDefinitionAt(analyses, 'file:///test.ex', source, 2, 4);
    // unknown_func is not defined, so no definitions
    expect(defs).toEqual([]);
  });

  it('returns empty for empty line', () => {
    const source = `defmodule MyApp do

end`;
    const analysis = analyzeElixirSource(source);
    const analyses = new Map([['file:///test.ex', analysis]]);

    const defs = findDefinitionAt(analyses, 'file:///test.ex', source, 1, 0);
    expect(defs).toEqual([]);
  });
});

// ─── Signature Help ──────────────────────────────────────────────────────────

describe('getSignatureHelpAt', () => {
  it('returns signature help inside a function call', () => {
    const source = `defmodule MyApp do
  def greet(name, greeting) do
    "\#{greeting}, \#{name}!"
  end

  def test do
    greet("World", "Hi")
  end
end`;
    const analysis = analyzeElixirSource(source);
    // Cursor after "greet(" at line 6
    const sig = getSignatureHelpAt(analysis, source, 6, 11);
    expect(sig).not.toBeNull();
    expect(sig!.signatures).toHaveLength(1);
    expect(sig!.signatures[0]!.label).toContain('greet');
    expect(sig!.signatures[0]!.parameters).toHaveLength(2);
    expect(sig!.activeParameter).toBe(0);
  });

  it('tracks active parameter with commas', () => {
    const source = `defmodule MyApp do
  def add(a, b, c) do
    a + b + c
  end

  def test do
    add(1, 2, 3)
  end
end`;
    const analysis = analyzeElixirSource(source);
    // Cursor after second comma: "add(1, 2, "
    const sig = getSignatureHelpAt(analysis, source, 6, 14);
    expect(sig).not.toBeNull();
    expect(sig!.activeParameter).toBe(2);
  });

  it('returns null when not inside a function call', () => {
    const source = `defmodule MyApp do
  def test do
    x = 42
  end
end`;
    const analysis = analyzeElixirSource(source);
    const sig = getSignatureHelpAt(analysis, source, 2, 5);
    expect(sig).toBeNull();
  });

  it('includes documentation in signature help', () => {
    const source = `defmodule MyApp do
  @doc "Adds two numbers"
  def add(a, b) do
    a + b
  end

  def test do
    add(1, 2)
  end
end`;
    const analysis = analyzeElixirSource(source);
    const sig = getSignatureHelpAt(analysis, source, 7, 8);
    expect(sig).not.toBeNull();
    expect(sig!.signatures[0]!.documentation).toBeDefined();
    expect(sig!.signatures[0]!.documentation!.value).toBe('Adds two numbers');
  });
});
