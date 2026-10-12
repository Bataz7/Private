from datetime import datetime, timezone
import discord
from discord import app_commands
from discord.ext import commands

class CustomEmbedModal(discord.ui.Modal):
    def __init__(self, channel: discord.TextChannel, color_choice: str):
        super().__init__(title="إنشاء وإرسال ايمبد مخصص")
        self.channel = channel
        self.color_choice = color_choice

        self.embed_title = discord.ui.TextInput(
            label="عنوان الايمبد",
            style=discord.TextStyle.short,
            placeholder="اكتب عنوان الإيمبد هنا...",
            required=True,
            max_length=256
        )
        self.add_item(self.embed_title)

        self.embed_description = discord.ui.TextInput(
            label="وصف الايمبد",
            style=discord.TextStyle.paragraph,
            placeholder="اكتب تفاصيل ووصف الإيمبد هنا...",
            required=True,
            max_length=4000
        )
        self.add_item(self.embed_description)

        self.image_url = discord.ui.TextInput(
            label="رابط صورة الايمبد (اختياري)",
            style=discord.TextStyle.short,
            placeholder="https://example.com/image.png",
            required=False,
            max_length=500
        )
        self.add_item(self.image_url)

        self.outside_text = discord.ui.TextInput(
            label="النص الخارجي خارج الايمبد (اختياري)",
            style=discord.TextStyle.short,
            placeholder="رسالة تظهر فوق الإيمبد...",
            required=False,
            max_length=500
        )
        self.add_item(self.outside_text)

    async def on_submit(self, interaction: discord.Interaction):
        # خيارات الألوان
        color_map = {
            "أزرق": discord.Color.blue(),
            "أخضر": discord.Color.green(),
            "أحمر": discord.Color.red(),
            "أصفر": discord.Color.gold(),
            "بنفسجي": discord.Color.purple(),
            "برتقالي": discord.Color.orange(),
            "أبيض": discord.Color.light_embed(),
            "أسود": discord.Color.dark_theme()
        }
        embed_color = color_map.get(self.color_choice, discord.Color.blue())

        embed = discord.Embed(
            title=self.embed_title.value,
            description=self.embed_description.value,
            color=embed_color,
            timestamp=datetime.now(timezone.utc)
        )

        # إضافة الصورة إذا تم وضع رابط
        if self.image_url.value:
            embed.set_image(url=self.image_url.value)

        content = self.outside_text.value if self.outside_text.value else None

        try:
            await self.channel.send(content=content, embed=embed)
            await interaction.response.send_message(f"✅ تم إرسال الايمبد بنجاح إلى الروم {self.channel.mention}!", ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f"❌ حدث خطأ أثناء إرسال الايمبد: {e}", ephemeral=True)

class EmbedMakerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ارسال-ايمبد", description="إرسال ايمبد نصي مخصص لأي روم تحدده")
    @app_commands.describe(
        channel="روم إرسال الإيمبد",
        color="اختر لون الايمبد"
    )
    @app_commands.rename(channel="الروم", color="اللون")
    @app_commands.choices(color=[
        app_commands.Choice(name="أزرق", value="أزرق"),
        app_commands.Choice(name="أخضر", value="أخضر"),
        app_commands.Choice(name="أحمر", value="أحمر"),
        app_commands.Choice(name="أصفر", value="أصفر"),
        app_commands.Choice(name="بنفسجي", value="بنفسجي"),
        app_commands.Choice(name="برتقالي", value="برتقالي"),
        app_commands.Choice(name="أبيض", value="أبيض"),
        app_commands.Choice(name="أسود", value="أسود")
    ])
    @app_commands.checks.has_permissions(administrator=True)
    async def send_embed(self, interaction: discord.Interaction, channel: discord.TextChannel, color: str):
        modal = CustomEmbedModal(channel, color)
        await interaction.response.send_modal(modal)

async def setup(bot):
    await bot.add_cog(EmbedMakerCog(bot))
