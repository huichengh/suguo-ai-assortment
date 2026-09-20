"""苏果智选 · 后台服务配置。

配置项通过环境变量或 server/.env 覆盖，均有可运行的默认值，
因此「克隆即跑」不需要任何前置配置。
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = SERVER_DIR.parent
ATTACHMENTS_DIR = PROJECT_ROOT / "attachments"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(SERVER_DIR / ".env"),
        env_prefix="SUGUO_",
        extra="ignore",
    )

    app_name: str = "苏果智选 API"
    api_prefix: str = "/api/v1"
    debug: bool = True

    # 默认用 SQLite 单文件，免安装即可运行；接生产库时改这一个变量即可
    database_url: str = f"sqlite:///{(SERVER_DIR / 'suguo.db').as_posix()}"

    # JWT 密钥：仅用于本地演示。生产部署必须通过环境变量注入强随机值。
    jwt_secret: str = "suguo-ai-assortment-demo-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120

    # 前端来源，用于 CORS（本地单文件页面以 file:// 打开时 Origin 为 null）
    cors_origins: list[str] = ["*"]

    # 算法默认参数：与前端 algos.js 保持完全一致，保证前后端结果可比对
    health_weights: dict[str, float] = {
        "qty": 0.30,
        "gp": 0.30,
        "turnover": 0.20,
        "space": 0.20,
    }
    apriori_min_support: float = 0.02
    apriori_min_confidence: float = 0.50
    apriori_min_lift: float = 1.50
    apriori_top_n: int = 30
    # 演示数据中 70 个商品名对应 5000+ 个 SKU 编码，一名多码极严重。
    # 按编码聚合会把同一商品拆成数百个稀疏项，支持度被稀释到产不出规则，
    # 故默认按商品名称聚合；接入真实数据且编码稳定后可切换为 "sku"。
    basket_aggregate_by: str = "name"


settings = Settings()
