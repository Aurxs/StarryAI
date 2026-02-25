"""仓库级辅助入口。

这个文件不承担实际业务逻辑，主要用于给开发者明确提示：
真正的后端服务入口在 `backend/app/main.py`。
"""

if __name__ == "__main__":
    # 这里仅输出启动提示，避免误以为该文件是业务主入口。
    print("Use: python3.12 -m uvicorn app.main:app --reload --app-dir backend")
