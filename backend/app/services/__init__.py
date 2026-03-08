"""Service package.

Keep package import side effects minimal to avoid circular imports.
Import concrete modules directly from their file paths instead of relying on
package-level re-exports.
"""

__all__: list[str] = []
