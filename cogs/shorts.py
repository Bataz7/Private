import discord
from discord.ext import commands
import re
import asyncio
from datetime import timedelta

class ShortsCommands(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # 1. أمر إعطاء أو إزالة الرتبة (!رتب @عضو @الرتبة)
    @commands.command(name="رتب")
    @commands.has_permissions(manage_roles=True)
    async def toggle_role(self, ctx, member: discord.Member, role: discord.Role):
        if ctx.guild.me.top_role <= role:
            await ctx.send("❌ عذراً، لا يمكنني إعطاء هذه الرتبة لأنها أعلى من رتبتي أو مساوية لها!")
            return

        if role in member.roles:
            await member.remove_roles(role, reason=f"بواسطة الأمر من قبل {ctx.author}")
            await ctx.send(f"✅ تم إزالة رتبة {role.mention} من العضو {member.mention}")
        else:
            await member.add_roles(role, reason=f"بواسطة الأمر من قبل {ctx.author}")
            await ctx.send(f"✅ تم إعطاء رتبة {role.mention} للعضو {member.mention}")

    @toggle_role.error
    async def toggle_role_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، أنت لا تملك صلاحية `إدارة الرتب` لاستخدام هذا الأمر!")
        elif isinstance(error, commands.BadArgument):
            await ctx.send("❌ الاستخدام الخاطئ للأمر! الصيغة الصحيحة: `!رتب @عضو @الرتبة`")
        else:
            await ctx.send("❌ حدث خطأ أثناء تنفيذ الأمر. تأكد من منشن العضو والرتبة بشكل صحيح.")

    # 2. أمر قفل الروم (!قفل)
    @commands.command(name="قفل")
    @commands.has_permissions(manage_channels=True)
    async def lock_channel(self, ctx):
        await ctx.channel.set_permissions(ctx.guild.default_role, send_messages=False)
        await ctx.send("🔒 تم قفل الروم بنجاح، لا يمكن للأعضاء الكتابة الآن.")

    @lock_channel.error
    async def lock_channel_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، لا تملك صلاحية `إدارة الرومات` لقفل الروم!")

    # 3. أمر فتح الروم (!فتح)
    @commands.command(name="فتح")
    @commands.has_permissions(manage_channels=True)
    async def unlock_channel(self, ctx):
        await ctx.channel.set_permissions(ctx.guild.default_role, send_messages=True)
        await ctx.send("🔓 تم فتح الروم بنجاح، يمكن للأعضاء الكتابة الآن.")

    @unlock_channel.error
    async def unlock_channel_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، لا تملك صلاحية `إدارة الرومات` لفتح الروم!")

    # 4. أمر حذف الرسائل (!حذف 50)
    @commands.command(name="حذف")
    @commands.has_permissions(manage_messages=True)
    async def clear_messages(self, ctx, amount: int):
        if amount <= 0:
            await ctx.send("❌ يرجى تحديد عدد أكبر من الصفر للحذف!")
            return
        
        try:
            await ctx.message.delete()
        except:
            pass

        deleted = await ctx.channel.purge(limit=amount)
        msg = await ctx.send(f"🗑️ تم حذف `{len(deleted)}` رسالة بنجاح.")
        await asyncio.sleep(3)
        try:
            await msg.delete()
        except:
            pass

    @clear_messages.error
    async def clear_messages_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، لا تملك صلاحية `إدارة الرسائل` لحذف الرسائل!")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send("❌ يرجى تحديد عدد الرسائل المراد حذفها! (مثال: `!حذف 50`)")

    # 5. أمر تبنيد عضو (!باند @عضو)
    @commands.command(name="باند")
    @commands.has_permissions(ban_members=True)
    async def ban_member(self, ctx, member: discord.Member, *, reason: str = "لم يُذكر سبب"):
        if ctx.author.top_role <= member.top_role and ctx.author != ctx.guild.owner:
            await ctx.send("❌ لا يمكنك تبنيد هذا العضو لأن رتبته مساوية أو أعلى من رتبتك!")
            return

        try:
            await member.ban(reason=f"بواسطة: {ctx.author} | السبب: {reason}")
            await ctx.send(f"🔨 تم حظر العضو {member.mention} من السيرفر بنجاح. السبب: `{reason}`")
        except Exception as e:
            await ctx.send(f"❌ حدث خطأ أثناء محاولة تبنيد العضو: {e}")

    @ban_member.error
    async def ban_member_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، لا تملك صلاحية `حظر الأعضاء` لتبنيد الأعضاء!")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send("❌ يرجى منشن العضو المراد تبنيده! (مثال: `!باند @عضو السبب`)")

    # 6. أمر التايم أوت (!تايم @عضو 1h أو 1d أو 1m أو 1w)
    @commands.command(name="تايم")
    @commands.has_permissions(moderate_members=True)
    async def timeout_member(self, ctx, member: discord.Member, duration: str):
        if ctx.author.top_role <= member.top_role and ctx.author != ctx.guild.owner:
            await ctx.send("❌ لا يمكنك إعطاء تايم أوت لهذا العضو لأن رتبته مساوية أو أعلى من رتبتك!")
            return

        match = re.match(r"^(\d+)([smhdw])$", duration.lower())
        if not match:
            await ctx.send("❌ صيغة الوقت غير صحيحة! أمثلة صحيحة: `30m` (دقائق)، `2h` (ساعات)، `1d` (أيام)، `1w` (أسابيع)")
            return

        value, unit = int(match.group(1)), match.group(2)
        
        delta_map = {
            's': timedelta(seconds=value),
            'm': timedelta(minutes=value),
            'h': timedelta(hours=value),
            'd': timedelta(days=value),
            'w': timedelta(weeks=value)
        }
        
        time_delta = delta_map[unit]

        try:
            await member.timeout(time_delta, reason=f"بواسطة: {ctx.author}")
            await ctx.send(f"⏳ تم اعطاء تايم أوت للعضو {member.mention} لمدة `{duration}` بنجاح.")
        except Exception as e:
            await ctx.send(f"❌ حدث خطأ أثناء إعطاء التايم أوت: {e}")

    @timeout_member.error
    async def timeout_member_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ عذراً، لا تملك صلاحية `تقييد الأعضاء` لإعطاء التايم أوت!")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send("❌ الاستخدام الخاطئ! (مثال: `!تايم @عضو 1h`)")

async def setup(bot):
    await bot.add_cog(ShortsCommands(bot))
